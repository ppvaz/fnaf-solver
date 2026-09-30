#!/usr/bin/env python3
"""No-device fixture for night jobs (Pedro, 2026-09-27: "Yes, play nights").

The queue's `night` kind, night-job.py and the overnight window, together,
against the fake phone in testdata/fake_phone.py: its `adb`, the Cue Helper
setup, the SNAP frame, the audio link, and a night runner that is handed the
real argv. What is real: the queue, the window, night-job.py, night_jobs.py,
device:emit on the committed k3 winner, title-observe.py with the real FNaF 2
title model over synthetic native frames, the serial lease, and the evidence
pack builder (writing into a fixture root, not this repository).

Covered:
- enqueue validation: committed winners only, the winner's own night and game,
  a closed argument vocabulary; the budget comes from the emitted plan;
- `cue.queue.run` never claims a night: only the window's `--nights` does;
- title mismatch -> refused before any runner, the game left at its title;
- a FNaF 2 story night -> refused: its Continue digit cannot be read yet;
- abort mid-night (SIGINT to the window's process group) with a runner that
  does not reset -> the game driven back to an observed title, the settings
  restored, the lease released, the job FAILED and never replayed;
- a night killed outright (SIGKILL after the graces) -> the window's own
  title recovery;
- a deadline too close for the night's budget -> the job is not started;
- a successful night -> the runner held the lease marker under the window's
  lease, the bundle was emitted fresh and hashed, the pack was written in the
  morning, and the summary line names it.
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FAKE = HERE / "testdata" / "fake_phone.py"
SERIAL = "FAKE0001"
K3 = "tools/device/campaign-night7-k3-winner.json"
N5 = "tools/device/campaign-night5-mask5plus-winner.json"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "testdata"))
import fake_phone  # noqa: E402
import night_jobs  # noqa: E402
from companion_device_lock import DeviceBusy, DeviceLock  # noqa: E402


def load(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


QUEUE = load("companion_queue", "companion-queue.py")

# Loads a module by path, sets the given constants (on it or on night_jobs),
# and runs its main(argv). Only this test sets them: production reads none.
DRIVER = r'''
import importlib.util, json, sys
from pathlib import Path
path, overrides = sys.argv[1], json.loads(Path(sys.argv[2]).read_text())
name = Path(path).stem.replace("-", "_")
spec = importlib.util.spec_from_file_location(name, path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
for key, value in overrides.get(name, {}).items():
    setattr(module, key, Path(value) if key.endswith("_ROOT") else value)
import night_jobs
for key, value in overrides.get("night_jobs", {}).items():
    setattr(night_jobs, key, value)
result = module.main(sys.argv[3:])
sys.exit(result)
'''

PACK = r'''
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [, , root, id] = process.argv;
const pack = await import(pathToFileURL(process.env.EVIDENCE_PACK_MODULE).href);
for (const target of pack.resolvePackTargets(root, id)) {
  const built = pack.buildPack({ root, home: '/home/fixture', ...target });
  const status = pack.writePack(join(root, pack.PACKS_DIR, target.packId), built);
  console.log(JSON.stringify({ id: target.packId, status, outcome: built.pack.outcome }));
}
'''

FAST_WINDOW = {
    "JOB_TIMEOUT_S": 1.0, "CHILD_WAIT_S": 0.5, "QUEUE_INTERVAL_S": 0.1,
    # The night job's own title recovery runs inside this grace (300 s live).
    "STOP_GRACE_S": 20.0, "TERM_GRACE_S": 1.0, "KILL_GRACE_S": 1.0,
    "RESTORE_BUDGET_S": 1.5, "NIGHT_RECOVERY_S": 30.0, "PACK_TIMEOUT_S": 60.0,
    "RESTORE_RETRY_S": 0.0, "RESTORE_RETRY_POLL_S": 0.1, "LOCK_POLL_S": 0.2, "ARM_POLL_S": 0.1,
}

failures: list[str] = []
passed = 0


def check(name: str, condition: bool, detail: object = "") -> None:
    global passed
    if condition:
        passed += 1
    else:
        failures.append(f"{name}: {str(detail)[:3000]}")


def clock(offset_s: float) -> str:
    return (datetime.now() + timedelta(seconds=offset_s)).strftime("%H:%M:%S")


class Case:
    def __init__(self, base: Path, name: str, window: dict | None = None, **phone):
        self.dir = base / name
        self.dir.mkdir()
        self.bin = self.dir / "bin"
        self.bin.mkdir()
        (self.bin / "adb").write_text(f"#!/bin/sh\nexec {sys.executable} {FAKE} adb \"$@\"\n", encoding="utf-8")
        (self.bin / "adb").chmod(0o755)
        self.driver = self.dir / "driver.py"
        self.driver.write_text(DRIVER, encoding="utf-8")
        self.pack = self.dir / "pack.mjs"
        self.pack.write_text(PACK, encoding="utf-8")
        self.state = self.dir / "phone.json"
        self.state.write_text(json.dumps(fake_phone.default_phone(**phone)), encoding="utf-8")
        self.queue_file = self.dir / "jobs.json"
        self.locks = self.dir / "locks"
        self.state_dir = self.dir / "state"
        self.windows = self.dir / "windows"
        self.jobs_dir = self.dir / "night-jobs"
        self.root = self.dir / "root"          # a fixture repository root for runs and packs
        (self.root / "artifacts" / "runs").mkdir(parents=True)
        self.overrides = self.dir / "overrides.json"
        self.overrides.write_text(json.dumps({
            "overnight_window": {
                **FAST_WINDOW, **(window or {}),
                "QUEUE_COMMAND": [sys.executable, str(self.driver), str(HERE / "companion-queue.py"),
                                  str(self.overrides)],
                "NIGHT_JOB_COMMAND": [sys.executable, str(self.driver), str(HERE / "night-job.py"),
                                      str(self.overrides)],
                "PACK_COMMAND": ["node", str(self.pack), str(self.root)],
                "PACKS_ROOT": str(self.root), "RUNS_ROOT": str(self.root)},
            "companion_queue": {
                "NIGHT_JOB_COMMAND": [sys.executable, str(self.driver), str(HERE / "night-job.py"),
                                      str(self.overrides)],
                "JOB_STOP_GRACE_S": 2.0, "JOB_TERM_GRACE_S": 1.0},
            "night_job": {
                "SETUP_COMMAND": [sys.executable, str(FAKE), "setup"],
                "SNAP_COMMAND": [sys.executable, str(FAKE), "snap"],
                "AUDIO_COMMAND": [sys.executable, str(FAKE), "audio"],
                "RUNNER_PREFIX": [sys.executable, str(FAKE), "runner"],
                "RUNS_ROOT": str(self.root), "SNAP_INTERVAL_S": 0.1,
                "RUNNER_STOP_GRACE_S": 2.0, "RUNNER_TERM_GRACE_S": 1.0},
            "night_jobs": {"TITLE_READ_TIMEOUT_S": 1.5},
        }), encoding="utf-8")

    def env(self, mode: str = "win") -> dict:
        env = {key: value for key, value in os.environ.items()
               if key not in ("ANDROID_SERIAL", "FNAF_SERIAL", "ADB_BIN", "CUE_HELPER_LEASE_OWNER_PID",
                              "FNAF_LEASE_HELD", "FNAF_WINDOW_START", "FNAF_WINDOW_END",
                              "FNAF_WINDOW_BATTERY_FLOOR")}
        env.update({"PATH": f"{self.bin}:{os.environ['PATH']}", "FAKE_PHONE_STATE": str(self.state),
                    "FAKE_RUNS_ROOT": str(self.root), "FAKE_RUNNER_MODE": mode,
                    "CUE_HELPER_QUEUE_FILE": str(self.queue_file), "CUE_HELPER_LOCK_DIR": str(self.locks),
                    "CUE_HELPER_STATE_DIR": str(self.state_dir), "FNAF_WINDOW_DIR": str(self.windows),
                    "FNAF_NIGHT_JOB_DIR": str(self.jobs_dir),
                    "EVIDENCE_PACK_MODULE": str(ROOT / "packages/review/src/evidence-pack.mjs")})
        return env

    def enqueue(self, game: str, winner: str, night: int, **options) -> dict:
        previous = os.environ.get("CUE_HELPER_QUEUE_FILE")
        os.environ["CUE_HELPER_QUEUE_FILE"] = str(self.queue_file)
        try:
            job = QUEUE.make_night_job(game, winner, night, **options)
            with contextlib.redirect_stdout(io.StringIO()):
                QUEUE.enqueue(job, json_output=True)
        finally:
            if previous is None:
                os.environ.pop("CUE_HELPER_QUEUE_FILE", None)
            else:
                os.environ["CUE_HELPER_QUEUE_FILE"] = previous
        return job

    def window_argv(self, end: float) -> list[str]:
        return [sys.executable, str(self.driver), str(HERE / "overnight-window.py"), str(self.overrides), "run",
                "--serial", SERIAL, "--start", clock(-60), "--end", clock(end), "--lock-wait", "1",
                "--live", "--confirm-live"]

    def window(self, mode: str = "win", end: float = 3 * 3600) -> subprocess.CompletedProcess:
        return subprocess.run(self.window_argv(end), cwd=ROOT, env=self.env(mode), stdout=subprocess.PIPE,
                              stderr=subprocess.STDOUT, text=True, timeout=300)

    def phone(self) -> dict:
        return json.loads(self.state.read_text(encoding="utf-8"))

    def calls(self, actor: str | None = None) -> list[dict]:
        log = Path(f"{self.state}.log")
        rows = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
        return [row for row in rows if actor is None or row["actor"] == actor]

    def runner_calls(self) -> list[dict]:
        path = Path(f"{self.state}.runner")
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def record(self) -> dict:
        files = sorted(self.windows.glob("window-*/window.json"))
        return json.loads(files[-1].read_text(encoding="utf-8")) if files else {}

    def job_record(self, job_id: str) -> dict:
        path = self.jobs_dir / job_id / "job.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}

    def queue_jobs(self) -> list[dict]:
        return json.loads(self.queue_file.read_text(encoding="utf-8")) if self.queue_file.exists() else []

    def lease_free(self) -> bool:
        previous = os.environ.get("CUE_HELPER_LOCK_DIR")
        os.environ["CUE_HELPER_LOCK_DIR"] = str(self.locks)
        try:
            with DeviceLock(SERIAL):
                return True
        except DeviceBusy:
            return False
        finally:
            if previous is None:
                os.environ.pop("CUE_HELPER_LOCK_DIR", None)
            else:
                os.environ["CUE_HELPER_LOCK_DIR"] = previous


def restored(case: Case, name: str) -> None:
    settings = case.phone()["settings"]
    check(f"{name}: every setting is back at its recorded value",
          all(settings.get(key) == value for key, value in fake_phone.PRIOR.items()), settings)
    check(f"{name}: the restore was read back and verified",
          (case.record().get("settings") or {}).get("restore", {}).get("verified") is True, case.record().get("settings"))
    check(f"{name}: the lease is free", case.lease_free())
    check(f"{name}: the window released the lease", case.record().get("lease") == {"acquired": True, "released": True},
          case.record().get("lease"))


def enqueue_checks(base: Path) -> None:
    case = Case(base, "enqueue")
    job = case.enqueue("fnaf2", K3, 7)
    check("enqueue: a committed k3 night 7 is queued as a night job",
          job["kind"] == "night" and job["state"] == "PENDING" and job["label"].startswith("q-"), job)
    check("enqueue: the plan hash and the night length come from a fresh emit",
          len(job["planSha256"] or "") == 64 and job["nightMs"] == 425000, job)
    check("enqueue: the budget is every step's bound plus the night",
          job["budgetS"] == night_jobs.budget_s(425000) and job["budgetS"] > 425, job["budgetS"])
    check("enqueue: the queue's timeout for it is its budget", QUEUE.job_timeout_s(job) == job["budgetS"])
    command = QUEUE.job_command(job)
    check("enqueue: the job runs night-job.py with no shell text",
          command[1].endswith("night-job.py") and command[2] == "run" and ";" not in " ".join(command), command)
    refusals = {
        "a night the winner does not bind": ("fnaf2", K3, 5, {}),
        "another game's winner": ("fnaf4", K3, 7, {}),
        "a path outside tools/device": ("fnaf2", "artifacts/k3-winner.json", 7, {}),
        "a path that climbs out": ("fnaf2", "tools/device/../../etc/passwd-winner.json", 7, {}),
        "a label with shell text": ("fnaf2", K3, 7, {"label": "k3;reboot"}),
        "audio on a game whose audio is fixed": ("fnaf1", "tools/device/fnaf1-custom-night7-420-grid420-winner.json",
                                                 7, {"audio": True}),
    }
    for name, (game, winner, night, options) in refusals.items():
        try:
            QUEUE.make_night_job(game, winner, night, **options)
            check(f"enqueue refuses {name}", False, "queued")
        except QUEUE.QueueError:
            check(f"enqueue refuses {name}", True)
    check("custody: a file git does not track is UNTRACKED",
          night_jobs.custody("tools/device/no-such-night-job-fixture-winner.json") == "UNTRACKED")
    check("title: FNaF 4 has no title model, so its night cannot be observed",
          night_jobs.title_expectation("fnaf4", 3)["readable"] is False)
    check("title: 7 is Custom Night, 6 is 6th Night, 1-5 the digit under Continue",
          night_jobs.title_expectation("fnaf2", 7)["item"] == "customNight"
          and night_jobs.title_expectation("fnaf2", 6)["item"] == "sixthNight"
          and night_jobs.title_expectation("fnaf2", 5) == {"readable": True, "item": "continue", "continueNight": 5})
    check("static halt: this checkout's executor has the post-night static halt", night_jobs.static_halt_present())

    # cue.queue.run (no --nights) never plays a night: it drains the check and holds the night.
    done_script = case.dir / "done-setup.sh"
    done_script.write_text("#!/bin/sh\necho 'SETUP PASS fixture'\nexit 0\n", encoding="utf-8")
    done_script.chmod(0o755)
    case.queue_file.write_text(json.dumps([job, QUEUE.make_job("menu-check", "menu", False, False)]) + "\n")
    previous = (QUEUE.HELPER_SETUP, QUEUE.select_device, QUEUE.device_ready, os.environ.get("CUE_HELPER_QUEUE_FILE"))
    QUEUE.HELPER_SETUP, QUEUE.select_device = done_script, (lambda: (SERIAL, None))
    QUEUE.device_ready = lambda serial: (True, None)
    os.environ["CUE_HELPER_QUEUE_FILE"] = str(case.queue_file)
    try:
        read, write = os.pipe()
        saved = os.dup(1)
        os.dup2(write, 1)
        try:
            code = QUEUE.run_queue(0.0, 0.1, 0, False)
            sys.stdout.flush()
        finally:
            os.dup2(saved, 1)
            os.close(write)
        output = os.read(read, 65536).decode()
        os.close(read)
    finally:
        QUEUE.HELPER_SETUP, QUEUE.select_device, QUEUE.device_ready = previous[:3]
        if previous[3] is None:
            os.environ.pop("CUE_HELPER_QUEUE_FILE", None)
        else:
            os.environ["CUE_HELPER_QUEUE_FILE"] = previous[3]
    states = [item["state"] for item in case.queue_jobs()]
    check("queue: without --nights the night stays PENDING and the check runs",
          code == 0 and states == ["PENDING", "DONE"] and "nights-held=1" in output, (code, states, output))


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="night-job-test-") as scratch:
        base = Path(scratch)
        enqueue_checks(base)

        # --- title mismatch: the save offers no Custom Night -> refused, no runner.
        mismatch = Case(base, "title-mismatch",
                        game={"package": "com.scottgames.fnaf2", "running": False, "screen": None,
                              "items": ["continue", "newGame", "sixthNight"]})
        job = mismatch.enqueue("fnaf2", K3, 7)
        result = mismatch.window()
        record = mismatch.job_record(job["id"])
        check("title-mismatch: the window ends JOB_FAILED", mismatch.record().get("outcome") == "JOB_FAILED",
              result.stdout[-3000:])
        check("title-mismatch: the job refuses TITLE_MISMATCH on an observed title",
              record.get("outcome") == "TITLE_MISMATCH" and record.get("titleBefore", {}).get("status") == "OBSERVED"
              and "customNight" in record.get("reason", ""), record)
        check("title-mismatch: no runner was started", mismatch.runner_calls() == [], mismatch.runner_calls())
        check("title-mismatch: the queue job is FAILED", [j["state"] for j in mismatch.queue_jobs()] == ["FAILED"])
        check("title-mismatch: the game is left at its title", mismatch.phone()["game"]["screen"] == "title")
        restored(mismatch, "title-mismatch")

        # --- a FNaF 2 story night: the Continue digit has no reader on FNaF 2 yet.
        story = Case(base, "story-night")
        job = story.enqueue("fnaf2", N5, 5)
        story.window()
        record = story.job_record(job["id"])
        check("story-night: refused, the Continue night is unreadable, never assumed",
              record.get("outcome") == "TITLE_MISMATCH" and "Continue night is unreadable" in record.get("reason", "")
              and story.runner_calls() == [], record)
        restored(story, "story-night")

        # --- the deadline: the night's budget does not fit -> not started.
        late = Case(base, "deadline")
        job = late.enqueue("fnaf2", K3, 7)
        result = late.window(end=900)
        check("deadline: the window ends DEADLINE before the night",
              late.record().get("outcome") == "DEADLINE" and "no-room" in (late.record().get("reason") or ""),
              result.stdout[-2000:])
        check("deadline: the night job was never started",
              not (late.jobs_dir / job["id"]).exists() and late.runner_calls() == []
              and [j["state"] for j in late.queue_jobs()] == ["PENDING"], late.queue_jobs())
        check("deadline: the phone was not touched beyond reads",
              not any(row["args"][1:3] == ["settings", "put"] for row in late.calls()), late.calls())
        check("deadline: the pending job carries the window's note",
              late.queue_jobs()[0].get("windowNote", {}).get("outcome") == "DEADLINE")

        # --- a successful night: packed in the morning.
        won = Case(base, "success")
        job = won.enqueue("fnaf2", K3, 7)
        result = won.window("win")
        record = won.job_record(job["id"])
        window = won.record()
        run_id = record.get("runId") or ""
        check("success: the window completes", window.get("outcome") == "COMPLETE" and result.returncode == 0,
              result.stdout[-4000:])
        check("success: the night was played to 6 AM", record.get("outcome") == "NIGHT_PLAYED"
              and record.get("terminal", {}).get("outcome") == "sixam", record)
        binding = record.get("binding", {})
        check("success: the bundle was emitted fresh into the job and hashed",
              binding.get("planSha256") == job["planSha256"] and len(binding.get("bundle", {}).get("manifestSha256", "")) == 64
              and Path(binding.get("bundle", {}).get("dir", "/none")).is_relative_to(won.jobs_dir), binding)
        calls = won.runner_calls()
        argv = calls[0]["argv"] if calls else []
        # night-run.sh is dry unless told otherwise (ADR 0002, 2026-09-29): a
        # night job that left the pair out would "play" a dry run and nothing else.
        check("success: night-run.sh was asked for a live night (--live --confirm-live)",
              "--live" in argv and "--confirm-live" in argv, argv)
        check("success: night-run.sh got the bundle, the night and --no-grade",
              bool(argv) and argv[0].endswith("night-run.sh") and argv[argv.index("--night") + 1] == "7"
              and "--no-grade" in argv and calls[0]["bundleManifest"] is True, calls)
        check("success: the runner ran with the lease-held marker, under the window's lease",
              bool(calls) and calls[0]["marker"] == "1" and calls[0]["lease"] == "HELD", calls)
        check("success: the title was observed before and after the night",
              record.get("titleBefore", {}).get("status") == "OBSERVED"
              and record.get("titleAfter", {}).get("status") == "OBSERVED", record)
        pack = won.root / "docs/evidence/runs" / run_id / "pack.json"
        check("success: the morning wrote the run's pack", run_id.startswith("night7-") and pack.is_file(),
              (run_id, window.get("morning")))
        if pack.is_file():
            check("success: the pack reads the 6 AM", json.loads(pack.read_text())["outcome"] == "WIN")
        summary = (won.windows / "summary.log").read_text() if (won.windows / "summary.log").exists() else ""
        check("success: one morning summary line names the night and its pack",
              summary.count("\n") == 1 and run_id in summary and "pack=packed:WIN" in summary
              and "restored verified" in summary, summary)
        check("success: the queue job is DONE", [j["state"] for j in won.queue_jobs()] == ["DONE"])
        restored(won, "success")

        # --- abort mid-night: SIGINT to the window's process group; the runner
        # exits without resetting, so the night job must drive the title itself.
        abort = Case(base, "abort")
        job = abort.enqueue("fnaf2", K3, 7)
        process = subprocess.Popen(abort.window_argv(3 * 3600), cwd=ROOT, env=abort.env("hang"),
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline and not abort.runner_calls():
            time.sleep(0.1)
        time.sleep(0.5)
        check("abort: the night was running", abort.phone()["game"]["screen"] == "night", abort.phone()["game"])
        os.killpg(process.pid, signal.SIGINT)
        output, _ = process.communicate(timeout=180)
        record = abort.job_record(job["id"])
        check("abort: the window ends ABORTED (exit 130)",
              process.returncode == 130 and abort.record().get("outcome") == "ABORTED", output[-4000:])
        check("abort: the game was driven back to an observed title",
              abort.phone()["game"] == {**abort.phone()["game"], "running": True, "screen": "title"}
              and record.get("titleAfter", {}).get("status") == "OBSERVED"
              and record.get("titleAfter", {}).get("relaunched") is True, (abort.phone()["game"], record.get("titleAfter")))
        check("abort: the job is INTERRUPTED and FAILED, never replayed",
              record.get("outcome") == "INTERRUPTED" and [j["state"] for j in abort.queue_jobs()] == ["FAILED"],
              (record.get("outcome"), abort.queue_jobs()))
        restored(abort, "abort")

        # --- killed outright: the runner ignores SIGINT and SIGTERM, everything
        # in the queue's group is SIGKILLed; the window recovers the title.
        killed = Case(base, "killed", window={"STOP_GRACE_S": 3.0})
        job = killed.enqueue("fnaf2", K3, 7)
        process = subprocess.Popen(killed.window_argv(3 * 3600), cwd=ROOT, env=killed.env("stubborn"),
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline and not killed.runner_calls():
            time.sleep(0.1)
        time.sleep(0.5)
        os.killpg(process.pid, signal.SIGINT)
        output, _ = process.communicate(timeout=180)
        window = killed.record()
        recoveries = window.get("nightRecoveries", [])
        check("killed: the window recovered the title itself",
              len(recoveries) == 1 and recoveries[0]["exit"] == 0 and "TITLE OBSERVED" in recoveries[0]["title"],
              (recoveries, output[-3000:]))
        check("killed: the game is at its title", killed.phone()["game"]["screen"] == "title", killed.phone()["game"])
        check("killed: the killed night job is FAILED, never replayed",
              [j["state"] for j in killed.queue_jobs()] == ["FAILED"], killed.queue_jobs())
        restored(killed, "killed")

        # Across every case: the night machinery asked the phone only what the fake knows.
        for case_dir in sorted(p for p in base.iterdir() if (p / "phone.json.log").exists()):
            rows = [json.loads(line) for line in (case_dir / "phone.json.log").read_text().splitlines()]
            unknown = [row["args"] for row in rows if not row["known"]]
            check(f"{case_dir.name}: every adb call is one the fake knows", unknown == [], unknown)
            forbidden = [row["args"] for row in rows
                         if any(word in row["args"] for word in ("locksettings", "tap", "swipe", "reboot"))]
            check(f"{case_dir.name}: no tap, lock-screen or reboot command", forbidden == [], forbidden)

    if failures:
        print("night jobs FAILED:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    print(f"night jobs: {passed} checks -- committed winners only; nights only in a window; title mismatch and "
          "an unreadable story night refused before any runner; abort mid-night and a killed night leave the "
          "game at an observed title with settings restored and the lease released; a night whose budget does "
          "not fit is not started; a played night is packed in the morning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
