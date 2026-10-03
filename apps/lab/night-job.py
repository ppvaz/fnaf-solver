#!/usr/bin/env python3
"""Play one queued night of a committed winner, then leave the game at an
observed title.

The Companion queue runs this for a `night` job, and claims night jobs only
inside an overnight window (overnight-window.py; Pedro, 2026-09-27: "Yes, play
nights"). It is never an agent-facing command.

  night-job.py run --job-id ID --game G --winner W --night N --label L
                   --winner-sha256 SHA --plan-sha256 SHA|none --budget-s S [--audio]
  night-job.py title --game G [--recover]

`run`, in order, each step bounded by its own timeout (night_jobs.py):

 1. the serial lease (borrowed from the window that holds it);
 2. custody: the winner is the committed file, byte for byte what was queued;
 3. the binding: for FNaF 2 a bundle emitted fresh into the job directory, its
    manifest and plan hashed into the record, refused if the plan moved since
    the job was queued, and refused on a checkout without the post-night
    static halt (669447b);
 4. the audio link, where the runner reads audio (FNaF 4), or where a FNaF 2
    job asked to retain it (`bt-audio-link.sh --ensure`);
 5. the title, OBSERVED (Companion SNAP, native-frame.ts, read by
    title-observe.py with the game's model), never assumed: the job refuses
    unless it offers the declared night -- Custom Night for 7, 6th Night for 6,
    and for 1-5 the digit under Continue. A game or night whose title cannot be
    read (no FNaF 4 model; no FNaF 2 Continue digit reader yet) is refused;
 6. the runner, in this process group so an abort reaches it directly:
    night-run.sh (FNaF 2), fnaf1-winner.ts (FNaF 1), fnaf4-run.sh (FNaF 4),
    with the lease-held marker each takes;
 7. after any end or abort: the title again, observed; if it is not, the game
    is force-stopped, relaunched and observed (mistake register 6).

Exit: 0 the night was played to a terminal the runner recorded (6 AM or a
death) and the title was observed after it; 1 refused, failed, or the title not
restored; 75 a transient hold before the night (`SETUP HOLD reason=`); 130
interrupted. The record is `artifacts/night-jobs/<job>/job.json`.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "packages/play/src/safety"))  # the serial lease: Play's
import night_jobs  # noqa: E402
import process_tree  # noqa: E402
from companion_device_lock import DeviceBusy, DeviceLock, lock_dir  # noqa: E402

SETUP_COMMAND = [str(HERE / "../../packages/play/bin/companion/companion-setup.sh")]
SNAP_COMMAND = ["node", str(HERE / "../../packages/play/bin/phone/native-frame.ts")]
TITLE_COMMAND = [sys.executable, str(HERE / "../../packages/play/src/sensors/screencap/title-observe.py")]
AUDIO_COMMAND = [str(ROOT / "packages/play/bin/audio/bt-audio-link.sh")]
# A test replaces the runner with a stand-in that receives the real argv.
RUNNER_PREFIX: list[str] | None = None
RUNS_ROOT = ROOT
ADB_TIMEOUT_S = 20.0
SNAP_TIMEOUT_S = 30.0
SNAP_INTERVAL_S = 3.0
RUNNER_STOP_GRACE_S = 120.0
RUNNER_TERM_GRACE_S = 20.0
RUNNER_KILL_GRACE_S = 10.0
SERIAL = re.compile(r"^[A-Za-z0-9._:-]{1,96}$")
SHA = re.compile(r"^[0-9a-f]{64}$")
HELD_SIGNALS = frozenset({signal.SIGINT, signal.SIGTERM, signal.SIGHUP})


job_root = night_jobs.job_root


def now_text() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent, text=True)
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        json.dump(value, output, indent=2, sort_keys=True)
        output.write("\n")
    os.replace(name, path)


class NightJob:
    def __init__(self, serial: str, job_id: str):
        self.serial = serial
        self.dir = job_root() / job_id
        self.dir.mkdir(parents=True, exist_ok=True)
        self.signals: list[str] = []
        self.lease: DeviceLock | None = None
        self.record: dict = {"schema": night_jobs.SCHEMA, "jobId": job_id, "serial": serial,
                             "startedAt": now_text(), "events": []}

    # -- bookkeeping
    def save(self) -> None:
        write_json(self.dir / "job.json", self.record)

    def event(self, name: str, /, **fields) -> None:
        self.record["events"].append({"at": now_text(), "type": name, **fields})
        detail = " ".join(f"{key}={value}" for key, value in fields.items())
        print(f"NIGHT-JOB {name}{' ' + detail if detail else ''}", flush=True)
        self.save()

    def on_signal(self, signum: int, _frame: object) -> None:
        self.signals.append(signal.Signals(signum).name)

    @property
    def aborted(self) -> bool:
        return bool(self.signals)

    def env(self, **extra: str) -> dict:
        env = dict(os.environ)
        env.update({"ANDROID_SERIAL": self.serial, "FNAF_SERIAL": self.serial, "FNAF_LEASE_HELD": "1",
                    "CUE_HELPER_LOCK_DIR": str(lock_dir())})
        if self.lease is not None:
            env["CUE_HELPER_LEASE_OWNER_PID"] = str(self.lease.owner_pid)
        env.update(extra)
        return env

    def call(self, command: list[str], timeout: float, *, stdin: bytes | None = None,
             own_session: bool = False) -> tuple[int, str]:
        """A bounded helper. After the night, helpers run in their own session
        so that a further interrupt cannot cut the title recovery short."""
        try:
            result = subprocess.run(command, cwd=ROOT, env=self.env(), input=stdin, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, timeout=timeout, start_new_session=own_session)
        except subprocess.TimeoutExpired:
            return 124, f"timeout after {timeout} s"
        except OSError as error:
            return 127, str(error)
        return result.returncode, result.stdout.decode("utf-8", errors="replace")

    def adb(self, *args: str, own_session: bool = False) -> tuple[int, str]:
        return self.call([os.environ.get("ADB_BIN", "adb"), "-s", self.serial, *args], ADB_TIMEOUT_S,
                         own_session=own_session)

    # -- the title
    def setup(self, game: str, own_session: bool) -> tuple[int, str]:
        target = night_jobs.GAMES[game]["setupTarget"]
        command = [*SETUP_COMMAND, "--target", target]
        if game == "fnaf2":
            # The helper's own FNAF2_MENU identity: the title, image-free.
            command += ["--screen", "menu", "--wait", str(night_jobs.SETUP_WAIT_S)]
        return self.call(command, night_jobs.SETUP_TIMEOUT_S, own_session=own_session)

    def read_title(self, game: str, expect: dict, own_session: bool) -> dict:
        """SNAP, then the game's title model; retried until a confident read."""
        model = night_jobs.GAMES[game]["titleModel"]
        if model is None:
            return {"status": "UNKNOWN", "reason": f"no {game} title model"}
        frames = self.dir / "frames"
        frames.mkdir(parents=True, exist_ok=True)
        deadline = time.monotonic() + night_jobs.TITLE_READ_TIMEOUT_S
        last = "no read"
        attempt = 0
        while time.monotonic() < deadline:
            attempt += 1
            frame = frames / f"title-{len(list(frames.iterdir())) + 1:03d}.png"
            code, output = self.call([*SNAP_COMMAND, "--out", str(frame), "--label", f"nj{attempt}"],
                                     SNAP_TIMEOUT_S, own_session=own_session)
            if code == 0 and frame.is_file():
                data = frame.read_bytes()
                code, verdict = self.call([*TITLE_COMMAND, "--model", str(ROOT / model)], SNAP_TIMEOUT_S,
                                          stdin=data, own_session=own_session)
                verdict = verdict.strip().splitlines()[-1] if verdict.strip() else ""
                read = {"frameSha256": night_jobs.sha256_bytes(data), "verdict": verdict, "attempts": attempt}
                if code == 0 and verdict.startswith("items="):
                    read.update({"status": "OBSERVED", "items": verdict[len("items="):].split(",")})
                    if expect.get("continueNight") is not None and "continue" in read["items"]:
                        code, digit = self.call([*TITLE_COMMAND, "--model", str(ROOT / model), "--continue-night"],
                                                SNAP_TIMEOUT_S, stdin=data, own_session=own_session)
                        digit = digit.strip().splitlines()[-1] if digit.strip() else ""
                        read["continueNight"] = int(digit[len("night="):]) if code == 0 and \
                            re.fullmatch(r"night=\d", digit) else None
                        read["continueVerdict"] = digit
                    return read
                last = verdict or f"title-observe exit {code}"
            else:
                last = f"snap exit {code}: {output.strip()[-200:]}"
            if self.aborted and not own_session:
                break
            time.sleep(min(SNAP_INTERVAL_S, max(0.0, deadline - time.monotonic())))
        return {"status": "UNKNOWN", "reason": last, "attempts": attempt}

    def ensure_title(self, game: str, phase: str, expect: dict | None = None) -> dict:
        """The title, observed. Before the night: set up capture and launch the
        game first. After it: read first. Either way, if the title is not read,
        force-stop the game, relaunch it and read again."""
        after = phase == "after"
        expect = expect or {}
        steps = []
        if phase == "before":
            code, output = self.setup(game, own_session=False)
            steps.append({"setup": code})
            hold = re.search(r"SETUP HOLD reason=([a-z0-9-]+)", output)
            if hold:
                return {"status": "HOLD", "reason": hold.group(1), "steps": steps}
            if code == 0:
                read = self.read_title(game, expect, own_session=False)
                if read["status"] == "OBSERVED":
                    return {**read, "steps": steps}
        else:
            read = self.read_title(game, expect, own_session=True)
            steps.append({"read": read.get("verdict") or read.get("reason")})
            if read["status"] == "OBSERVED":
                return {**read, "steps": steps}
        if self.aborted and not after:
            return {"status": "UNKNOWN", "reason": "aborted", "steps": steps}
        package = night_jobs.GAMES[game]["package"]
        code, _ = self.adb("shell", "am", "force-stop", package, own_session=after)
        steps.append({"forceStop": code})
        code, output = self.setup(game, own_session=after)
        steps.append({"setup": code})
        hold = re.search(r"SETUP HOLD reason=([a-z0-9-]+)", output)
        if hold and not after:
            return {"status": "HOLD", "reason": hold.group(1), "steps": steps}
        read = self.read_title(game, expect, own_session=after)
        return {**read, "steps": steps, "relaunched": True}

    # -- the job
    def refuse(self, outcome: str, reason: str, code: int = 1) -> int:
        if self.aborted and code != 130:
            # A step that failed because the window's interrupt killed it.
            outcome, reason, code = "INTERRUPTED", f"signal {self.signals[0]}; then {outcome}: {reason}", 130
        self.record.update({"outcome": outcome, "reason": reason})
        self.event("refused", outcome=outcome, reason=reason)
        return code

    def run(self, args: argparse.Namespace) -> int:
        game, night, winner_path = args.game, args.night, args.winner
        self.record.update({"game": game, "night": night, "winner": winner_path, "label": args.label,
                            "budgetS": args.budget_s, "audio": args.audio})
        try:
            winner = night_jobs.validate(game, winner_path, night, args.label, args.audio)
        except night_jobs.NightJobError as error:
            return self.refuse("INVALID", str(error))
        actual = night_jobs.sha256_file(ROOT / winner_path)
        if actual != args.winner_sha256:
            return self.refuse("WINNER_CHANGED", f"{winner_path} is {actual}, the job queued {args.winner_sha256}")
        try:
            binding = night_jobs.resolve_binding(game, winner_path, winner, night, self.dir / "bundle")
        except night_jobs.NightJobError as error:
            return self.refuse("BINDING", str(error))
        self.record["binding"] = binding
        self.event("bound", winnerSha256=binding["winnerSha256"], planSha256=binding.get("planSha256"),
                   manifestSha256=(binding.get("bundle") or {}).get("manifestSha256"), nightMs=binding["nightMs"])
        if game == "fnaf2" and binding["planSha256"] != args.plan_sha256:
            return self.refuse("BUNDLE_DRIFT", f"the plan emitted now is {binding['planSha256']}, "
                                               f"the job queued {args.plan_sha256}")
        if night_jobs.budget_s(binding["nightMs"]) > args.budget_s + 1.0:
            return self.refuse("BUDGET_GREW", f"{night_jobs.budget_s(binding['nightMs']):.0f} s > {args.budget_s:.0f} s")
        if self.aborted:
            return self.refuse("INTERRUPTED", f"signal {self.signals[0]} before the night", 130)

        spec = night_jobs.GAMES[game]
        if spec["audio"] == "required" or (spec["audio"] == "optional" and args.audio):
            code, output = self.call([*AUDIO_COMMAND, "--ensure", "--game-package", spec["package"]],
                                     night_jobs.AUDIO_LINK_TIMEOUT_S)
            self.event("audio-link", exit=code, status=(output.strip().splitlines() or [""])[-1][-200:])
            if code != 0:
                return self.refuse("AUDIO_LINK", f"bt-audio-link.sh --ensure exit {code}")

        expect = night_jobs.title_expectation(game, night)
        self.record["titleExpected"] = expect
        if not expect["readable"]:
            return self.refuse("TITLE_UNREADABLE", expect["reason"])
        before = self.ensure_title(game, "before", expect)
        self.record["titleBefore"] = before
        self.event("title-before", status=before["status"], items=",".join(before.get("items", [])),
                   continueNight=before.get("continueNight"))
        if before["status"] == "HOLD":
            print(f"SETUP HOLD reason={before['reason']} serial={self.serial}", flush=True)
            self.record.update({"outcome": "HELD", "reason": before["reason"]})
            self.save()
            return 75
        if before["status"] != "OBSERVED":
            return self.refuse("TITLE_UNREADABLE", before.get("reason", "the title was not read"))
        mismatch = title_mismatch(expect, before)
        if mismatch:
            return self.refuse("TITLE_MISMATCH", mismatch)
        if self.aborted:
            return self.refuse("INTERRUPTED", f"signal {self.signals[0]} before the night", 130)

        try:
            argv, marker = night_jobs.runner_command(game, binding, winner, night, args.label, self.serial, args.audio)
        except night_jobs.Unbound as error:   # VENUE_UNBOUND or QUALIFICATION_UNBOUND: refused before the runner
            return self.refuse(error.code, str(error))
        custody = lambda flag: [{"path": os.path.relpath(argv[i + 1], ROOT), "sha256": hashlib.sha256(Path(argv[i + 1]).read_bytes()).hexdigest()}
                                for i, item in enumerate(argv) if item == flag]
        if custody("--venue-binding"):
            self.record["venueBindings"] = custody("--venue-binding")
        if custody("--qualification"):
            self.record["qualification"] = custody("--qualification")[0]
        if RUNNER_PREFIX:
            argv = [*RUNNER_PREFIX, *argv]
        self.record["runner"] = {"argv": argv, "marker": marker, "timeoutS": night_jobs.runner_timeout_s(binding["nightMs"])}
        code, output, stopped = -1, "", None
        try:
            code, output, stopped = self.run_runner(argv, self.env(**marker),
                                                    night_jobs.runner_timeout_s(binding["nightMs"]))
        finally:
            run_id = night_jobs.run_id_from(game, output)
            terminal = night_jobs.terminal_of(game, run_id, RUNS_ROOT)
            self.record.update({"runId": run_id, "terminal": terminal,
                                "runnerExit": code, "runnerStopped": stopped})
            self.event("runner-ended", exit=code, runId=run_id, outcome=terminal.get("outcome"),
                       stopped=stopped, signals=",".join(self.signals))
            # A SIGTERM is the window's second step: its grace is short, and
            # its own recovery runs after this process is gone.
            if "SIGTERM" in self.signals:
                after = {"status": "SKIPPED", "reason": "SIGTERM: the window recovers the title"}
            else:
                # Held while the title is recovered: a helper spawned now cannot
                # be killed by a signal to this group between fork and setsid()
                # (overnight-window.py measured it). What arrives is recorded.
                blocked = signal.pthread_sigmask(signal.SIG_BLOCK, HELD_SIGNALS)
                try:
                    after = self.ensure_title(game, "after")
                    held = sorted(sig.name for sig in signal.sigpending() & HELD_SIGNALS)
                    if held:
                        after["signalsHeld"] = held
                finally:
                    signal.pthread_sigmask(signal.SIG_SETMASK, blocked)
            self.record["titleAfter"] = after
            self.event("title-after", status=after["status"], items=",".join(after.get("items", [])),
                       relaunched=after.get("relaunched", False))
        if self.aborted:
            self.record.update({"outcome": "INTERRUPTED", "reason": f"signal {self.signals[0]}"})
            self.save()
            return 130
        if after["status"] != "OBSERVED":
            return self.refuse("TITLE_NOT_RESTORED", after.get("reason", "the title was not read after the night"))
        if stopped:
            return self.refuse("RUNNER_TIMEOUT", f"the runner outlived {night_jobs.runner_timeout_s(binding['nightMs']):.0f} s")
        if not night_jobs.ran_to_terminal(game, terminal, code):
            return self.refuse("RUNNER_FAILED", f"exit {code}, terminal {terminal.get('outcome')}")
        self.record.update({"outcome": "NIGHT_PLAYED", "reason": terminal.get("outcome")})
        self.save()
        return 0

    def run_runner(self, argv: list[str], env: dict, timeout_s: float) -> tuple[int, str, str | None]:
        """The runner shares this process group: the window's stop and an
        operator's Ctrl-C reach it directly, and it runs its own cleanup. This
        process waits for that, and stops the runner itself only at its bound."""
        log = self.dir / "runner.log"
        named = next((Path(part).name for part in argv if part.endswith((".sh", ".mjs", ".py"))), argv[0])
        self.event("runner-start", runner=named, timeoutS=round(timeout_s))
        with log.open("w", encoding="utf-8") as output:
            child = subprocess.Popen(argv, cwd=ROOT, env=env, stdout=output, stderr=subprocess.STDOUT)
        stopped = None
        try:
            child.wait(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            stopped = "timeout"
            # The runner shares this process group, so it is stopped by its tree, not by killpg.
            process_tree.stop(child, lambda signum: process_tree.signal_tree(child.pid, signum),
                              (RUNNER_STOP_GRACE_S, RUNNER_TERM_GRACE_S, RUNNER_KILL_GRACE_S),
                              on_signal=lambda signum: self.event("runner-signal", signal=signum.name))
        text = log.read_text(encoding="utf-8", errors="replace")
        tail = "\n".join(text.splitlines()[-40:])
        if tail:
            print(tail, flush=True)
        return child.returncode if child.returncode is not None else -9, text, stopped


def title_mismatch(expect: dict, read: dict) -> str | None:
    items = read.get("items", [])
    if expect["item"] not in items:
        return f"the title offers {','.join(items) or 'nothing'}, not {expect['item']}"
    if expect.get("continueNight") is not None:
        if read.get("continueNight") is None:
            return f"the Continue night is unreadable ({read.get('continueVerdict', 'no read')})"
        if read["continueNight"] != expect["continueNight"]:
            return f"the title's Continue is night {read['continueNight']}, the job declares {expect['continueNight']}"
    return None


def parse(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="One queued night of a committed winner")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run")
    run.add_argument("--job-id", required=True)
    run.add_argument("--game", required=True, choices=tuple(night_jobs.GAMES))
    run.add_argument("--winner", required=True)
    run.add_argument("--night", required=True, type=int)
    run.add_argument("--label", required=True)
    run.add_argument("--winner-sha256", required=True)
    run.add_argument("--plan-sha256", required=True)
    run.add_argument("--budget-s", required=True, type=float)
    run.add_argument("--audio", action="store_true")
    title = sub.add_parser("title")
    title.add_argument("--game", required=True, choices=tuple(night_jobs.GAMES))
    title.add_argument("--recover", action="store_true", help="force-stop and relaunch if the title is not read")
    args = parser.parse_args(argv)
    if args.command == "run":
        if not re.fullmatch(r"cue-\d+-[0-9a-f]{8}", args.job_id):
            parser.error("--job-id is a queue job id")
        if not SHA.fullmatch(args.winner_sha256) or not (args.plan_sha256 == "none" or SHA.fullmatch(args.plan_sha256)):
            parser.error("--winner-sha256 and --plan-sha256 are sha256 hex (or none)")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse(argv)
    serial = os.environ.get("ANDROID_SERIAL") or os.environ.get("FNAF_SERIAL") or ""
    if not SERIAL.fullmatch(serial):
        print("NIGHT-JOB ERROR ANDROID_SERIAL names no device", file=sys.stderr)
        return 2
    job = NightJob(serial, args.job_id if args.command == "run" else f"title-{int(time.time())}")
    for signum in HELD_SIGNALS:
        signal.signal(signum, job.on_signal)
    with contextlib.ExitStack() as held:
        held.callback(setattr, job, "lease", None)  # last out: the lease is released, then forgotten
        try:
            job.lease = held.enter_context(DeviceLock(serial))
        except DeviceBusy as error:
            print(f"SETUP HOLD reason=device-busy serial={serial} detail={error}", flush=True)
            return 75
        if args.command == "title":
            read = job.ensure_title(args.game, "after") if args.recover else \
                job.read_title(args.game, {}, own_session=True)
            job.record.update({"game": args.game, "title": read})
            job.save()
            print(f"TITLE {read['status']} " + json.dumps({k: v for k, v in read.items() if k != 'steps'},
                                                          sort_keys=True), flush=True)
            return 0 if read["status"] == "OBSERVED" else 1
        code = job.run(args)
    # The result is decided: held from here to exit, so an interrupt during the
    # interpreter's own exit cannot replace this code with a SIGINT death.
    signal.pthread_sigmask(signal.SIG_BLOCK, HELD_SIGNALS)
    job.record["finishedAt"] = now_text()
    job.record["exit"] = code
    job.save()
    print("NIGHT-JOB RESULT " + json.dumps({key: job.record.get(key) for key in
                                            ("jobId", "game", "night", "outcome", "reason", "runId")},
                                           sort_keys=True), flush=True)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
