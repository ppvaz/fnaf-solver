"""Night jobs: one night of a COMMITTED winner, queued for an overnight window.

Pedro, 2026-09-27, asked whether overnight windows may play full nights
unattended on his phone: "Yes, play nights". A night job is the queue's one
game-playing vocabulary word. It names a committed winner file and one night of
it, and nothing else: no shell text, no coordinates, no timing. The runner is
fixed by the winner's schema, and every runner is an existing, gated one:

    winner-v1              FNaF 2  packages/play/bin/phone/night-run.sh (bundle emitted fresh)
    fnaf1-route-winner-v1  FNaF 1  packages/play/games/fnaf1/fnaf1-winner.ts (the pinned tree)
    fnaf4-route-winner-v1  FNaF 4  packages/play/games/fnaf4/fnaf4-run.sh --mode loop

Every runner is dry unless told otherwise (ADR 0002, 2026-09-29), so each
command below passes `--live --confirm-live` itself: a night job is a live
night by definition, and a runner that went dry would play nothing.

The queue (companion-queue.py) validates a job here when it is enqueued, and
night-job.py runs it. The budget below is the sum of bounds each step enforces
with its own timeout, plus the night's own length from the binding (the
emitted plan's `#observe-until`, or the route winner's `stopAfterMs`). It is
never a guess at how long a night takes: a step that overruns its bound is
stopped, and the window starts no job whose budget does not fit.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]

SCHEMA = "night-job-v1"
# The kernel's WINNER_FILE (packages/kernel/src/bindings.ts), which JavaScript reads; mirrored here.
WINNER_PATH = re.compile(r"^packages/propose/bindings/fnaf[1-4]/[a-z0-9][a-z0-9.-]{0,80}-winner\.json$")
LABEL = re.compile(r"^[a-z0-9][a-z0-9-]{0,24}$")
STATIC_HALT_SOURCE = ROOT / "packages/play/src/campaign/adb-device-local-executor.ts"
STATIC_HALT_EXPORT = "export const POST_NIGHT_STATIC_HALT"

GAMES = {
    "fnaf2": {
        "schema": "winner-v1",
        "package": "com.scottgames.fnaf2",
        "titleModel": "packages/play/profiles/fnaf2/moto-g56/title-moto-g56-v207.json",
        "setupTarget": "fnaf2",
        # Audio is retained evidence on FNaF 2, not a control input: opt-in.
        "audio": "optional",
    },
    "fnaf1": {
        "schema": "fnaf1-route-winner-v1",
        "package": "com.scottgames.fivenightsatfreddys",
        "titleModel": "packages/play/profiles/fnaf1/moto-g56/title-fnaf1-moto-g56-v207.json",
        "setupTarget": "fnaf1",
        "audio": "none",
    },
    "fnaf4": {
        "schema": "fnaf4-route-winner-v1",
        "package": "com.scottgames.fnaf4",
        # No FNaF 4 title model exists: its runner presses CONTINUE on a SNAP
        # "read by a person". A night job observes the title before it plays,
        # so a FNaF 4 job refuses TITLE_UNREADABLE until a model is measured.
        "titleModel": None,
        "setupTarget": "fnaf4",
        # fnaf4-run.ts reads the A2DP mix live (packages/play/bin/audio/fnaf4-cues.py).
        "audio": "required",
    },
}

# --- the budget: bounds each step enforces, in seconds ------------------------
EMIT_TIMEOUT_S = 120.0          # device:emit's bounded replay
AUDIO_LINK_TIMEOUT_S = 120.0    # bt-audio-link.sh --ensure (fnaf4-run.ts allows it 90 s)
SETUP_WAIT_S = 60               # companion-setup.sh --wait: the helper's FNAF2_MENU identity
SETUP_TIMEOUT_S = 180.0         # the setup process: install/consent/launch plus that wait
TITLE_READ_TIMEOUT_S = 90.0     # SNAP + title-observe retries until a confident read
RUNNER_PRE_S = 300.0            # the runner's own preflight, menu and intro before the night
RUNNER_POST_S = 600.0           # terminal waits, recording pull, title reset, analysis and pack
POST_TITLE_S = 300.0            # the job's own title check, force-stop and relaunch after the night
QUEUE_MARGIN_S = 60.0           # the queue's backstop timeout over the budget


class NightJobError(ValueError):
    pass


def job_root() -> Path:
    """Where each night job's record lives: artifacts/night-jobs/<job id>/job.json."""
    return Path(os.environ.get("FNAF_NIGHT_JOB_DIR", str(ROOT / "artifacts/night-jobs")))


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=ROOT, check=False, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)


def custody(path: str) -> str:
    """COMMITTED, UNTRACKED or MODIFIED: a night plays only the committed file."""
    if git("ls-files", "--error-unmatch", "--", path).returncode != 0:
        return "UNTRACKED"
    if git("diff", "--quiet", "HEAD", "--", path).returncode != 0:
        return "MODIFIED"
    return "COMMITTED"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def load_winner(path: str) -> dict:
    if not WINNER_PATH.fullmatch(path or ""):
        raise NightJobError(f"a night job names a packages/propose/bindings/<game>/*-winner.json file, not {path!r}")
    file = ROOT / path
    try:
        winner = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise NightJobError(f"winner unreadable: {path}: {error}") from error
    if not isinstance(winner, dict):
        raise NightJobError(f"winner is not an object: {path}")
    return winner


def game_of(winner: dict) -> str | None:
    for game, spec in GAMES.items():
        if winner.get("schema") == spec["schema"]:
            return game
    return None


def declared_night_ok(game: str, winner: dict, night: int) -> str | None:
    """None when the winner binds this night; else why not."""
    if game == "fnaf2":
        nights = winner.get("nights")
        if not isinstance(nights, list) or night not in nights:
            return f"night {night} is not one of the winner's nights {nights}"
        return None
    bound = winner.get("night", {})
    if game == "fnaf4":
        if bound.get("night") != night:
            return f"the FNaF 4 winner won night {bound.get('night')}, not {night}"
        return None
    # FNaF 1 route winners are Custom Night bindings (night 7 on the title).
    if bound.get("mode") == "Custom Night":
        return None if night == 7 else f"the FNaF 1 winner is a Custom Night (7), not {night}"
    return f"the FNaF 1 winner's night mode {bound.get('mode')!r} is not supported"


def validate(game: str, winner_path: str, night: int, label: str, audio: bool) -> dict:
    """Everything a job can be refused for before it is queued."""
    if game not in GAMES:
        raise NightJobError(f"game must be one of {', '.join(GAMES)}")
    if not isinstance(night, int) or not 1 <= night <= 8:
        raise NightJobError("night must be 1..8")
    if not LABEL.fullmatch(label or ""):
        raise NightJobError("label is 1-25 lowercase letters, digits and hyphens")
    winner = load_winner(winner_path)
    schema_game = game_of(winner)
    if schema_game != game:
        raise NightJobError(f"{winner_path} is a {winner.get('schema')} ({schema_game}), not a {game} winner")
    state = custody(winner_path)
    if state != "COMMITTED":
        raise NightJobError(f"{winner_path} is {state}: a night plays only the committed winner")
    problem = declared_night_ok(game, winner, night)
    if problem:
        raise NightJobError(problem)
    if audio and GAMES[game]["audio"] != "optional":
        raise NightJobError(f"audio is fixed for {game} ({GAMES[game]['audio']}), not a job option")
    return winner


def static_halt_present() -> bool:
    """The executor's post-night static halt (669447b) is in this checkout."""
    try:
        return STATIC_HALT_EXPORT in STATIC_HALT_SOURCE.read_text(encoding="utf-8")
    except OSError:
        return False


def plan_observe_until_ms(text: str) -> int:
    match = re.search(r"^#observe-until\s+(\d+)\s*$", text, re.M)
    if not match:
        raise NightJobError("the emitted plan declares no #observe-until")
    return int(match.group(1))


def expand_home(path: str) -> Path:
    return Path(os.path.expanduser(path))


def detectors_check(winner: dict) -> dict:
    detectors = winner.get("detectors")
    if not isinstance(detectors, dict) or not detectors.get("file"):
        return {"status": "NONE"}
    file = expand_home(detectors["file"])
    pinned = detectors.get("sha256")
    if not file.is_file():
        return {"status": "MISSING", "file": detectors["file"], "pinned": pinned}
    actual = sha256_file(file)
    return {"status": "MATCH" if actual == pinned else "MISMATCH", "file": detectors["file"],
            "pinned": pinned, "actual": actual}


def emit_bundle(winner_path: str, out_dir: Path, timeout_s: float = EMIT_TIMEOUT_S) -> dict:
    """device:emit, fresh, into an empty directory; the manifest and plans hashed."""
    try:
        result = subprocess.run(["node", str(HERE / "../../packages/propose/bin/plans/emit.ts"), "--winner", winner_path, "--out", str(out_dir)],
                                cwd=ROOT, check=False, text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, timeout=timeout_s, start_new_session=True)
    except subprocess.TimeoutExpired as error:
        raise NightJobError(f"device:emit exceeded {timeout_s} s") from error
    if result.returncode != 0:
        raise NightJobError(f"device:emit refused {winner_path}: {result.stdout.strip()[-500:]}")
    manifest_bytes = (out_dir / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    plans = {}
    for entry in manifest.get("plans", []):
        data = (out_dir / entry["file"]).read_bytes()
        if sha256_bytes(data) != entry.get("sha256"):
            raise NightJobError(f"emitted plan {entry['file']} does not match its manifest hash")
        plans[int(entry["night"])] = {"file": entry["file"], "sha256": entry["sha256"],
                                      "observeUntilMs": plan_observe_until_ms(data.decode("utf-8"))}
    return {"dir": str(out_dir), "manifestSha256": sha256_bytes(manifest_bytes),
            "winnerHash": manifest.get("winnerHash"), "engineHash": manifest.get("engineHash"),
            "profile": (manifest.get("profile") or {}).get("id"),
            "anchorEpochMs": manifest.get("anchorEpochMs"), "plans": plans,
            "emitOutput": result.stdout.strip()[-500:]}


def resolve_binding(game: str, winner_path: str, winner: dict, night: int, out_dir: Path | None) -> dict:
    """What this night plays, hashed: the winner file, and for FNaF 2 the bundle
    emitted fresh from it. `out_dir` None emits into a scratch directory that is
    removed again (the enqueue-time check)."""
    binding = {"game": game, "winner": winner_path, "winnerSha256": sha256_file(ROOT / winner_path),
               "night": night}
    if game == "fnaf2":
        if not static_halt_present():
            raise NightJobError("this checkout's executor has no post-night static halt (669447b); "
                                "a night must not press through the post-death screens")
        binding["staticHalt"] = "POST_NIGHT_STATIC_HALT"
        scratch = None
        if out_dir is None:
            scratch = Path(tempfile.mkdtemp(prefix="night-job-emit-"))
            out_dir = scratch / "bundle"
        try:
            bundle = emit_bundle(winner_path, out_dir)
        finally:
            if scratch is not None:
                shutil.rmtree(scratch, ignore_errors=True)
        plan = bundle["plans"].get(night)
        if plan is None:
            raise NightJobError(f"the emitted bundle has no plan for night {night}")
        binding.update({"bundle": {key: value for key, value in bundle.items() if key != "plans"},
                        "planSha256": plan["sha256"], "nightMs": plan["observeUntilMs"],
                        "profile": bundle["profile"] or winner.get("profile")})
        if scratch is not None:
            binding["bundle"]["dir"] = None
        return binding
    detectors = detectors_check(winner)
    binding["detectors"] = detectors
    if detectors["status"] not in ("MATCH", "NONE"):
        raise NightJobError(f"the winner's detectors file is {detectors['status']} ({detectors.get('file')}); "
                            f"it ran with sha256 {detectors.get('pinned')}")
    stop_after = (winner.get("resolvedOptions") or {}).get("stopAfterMs")
    if not isinstance(stop_after, int) or stop_after <= 0:
        raise NightJobError("the route winner declares no resolvedOptions.stopAfterMs")
    binding["nightMs"] = stop_after
    return binding


def runner_timeout_s(night_ms: int) -> float:
    return RUNNER_PRE_S + night_ms / 1000.0 + RUNNER_POST_S


def budget_s(night_ms: int) -> float:
    """The job's whole bound: every pre-night step, the runner, and the title after."""
    before = EMIT_TIMEOUT_S + AUDIO_LINK_TIMEOUT_S + SETUP_TIMEOUT_S + TITLE_READ_TIMEOUT_S
    return before + runner_timeout_s(night_ms) + POST_TITLE_S


def title_expectation(game: str, night: int) -> dict:
    """What the title must show before this night is played, or why it cannot be read."""
    if GAMES[game]["titleModel"] is None:
        return {"readable": False, "reason": f"no {game} title model: its title's night cannot be observed"}
    if night == 7:
        return {"readable": True, "item": "customNight"}
    if night == 6:
        return {"readable": True, "item": "sixthNight"}
    return {"readable": True, "item": "continue", "continueNight": night}


VENUE_BINDINGS = ROOT / "docs" / "evidence"
QUALIFICATIONS = ROOT / "docs" / "evidence"

class Unbound(ValueError):
    """A FNaF 2 night whose committed custody lacks what a live campaign requires; `code` names the refusal."""
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code

def qualification_for(winner_hash: str | None, engine_hash: str | None, root: Path = QUALIFICATIONS) -> Path | None:
    """The committed qualification a live campaign accepts for this bundle: qualification-v1/v2, PASS,
    DEVICE_MEASURED, its policyHash the bundle's winner and its modelHash the bundle's engine (campaign-preflight's
    qualification-binding gate). The newest by name when several bind it; None when none does."""
    if not winner_hash or not engine_hash:
        return None
    found = []
    for path in sorted(root.glob("qualification-*.json")):
        try:
            record = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if (record.get("schema") in ("qualification-v1", "qualification-v2") and record.get("verdict") == "PASS"
                and record.get("claimLevel") == "DEVICE_MEASURED" and record.get("policyHash") == winner_hash
                and record.get("modelHash") == engine_hash):
            found.append(path)
    return found[-1] if found else None

def venue_bindings(profile: str, root: Path = VENUE_BINDINGS) -> list[Path]:
    """The committed venue-binding-v1 files whose subject is this profile. Since 2026-09-30 a live FNaF 2 campaign
    refuses `venue-identity-unbound` without one, and the campaign itself still refuses a binding whose identity has
    drifted, so passing every committed binding for the profile is safe: the phone decides which one holds."""
    found = []
    for path in sorted(root.glob("venue-binding-*.json")):
        try:
            record = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        subject = record.get("subject") or {}
        if record.get("schema") == "venue-binding-v1" and subject.get("kind") == "profile" and subject.get("id") == profile:
            found.append(path)
    return found

def runner_command(game: str, binding: dict, winner: dict, night: int, label: str, serial: str,
                   audio: bool) -> tuple[list[str], dict]:
    """The one runner a game's night uses, and the lease-held marker it takes."""
    if game == "fnaf2":
        venues = venue_bindings(binding["profile"])
        if not venues:
            raise Unbound("VENUE_UNBOUND", f"no committed venue binding names profile {binding['profile']}: a live night would refuse venue-identity-unbound")
        qualification = qualification_for(binding["bundle"].get("winnerHash"), binding["bundle"].get("engineHash"))
        if qualification is None:
            raise Unbound("QUALIFICATION_UNBOUND", f"no committed qualification binds winner {binding['bundle'].get('winnerHash')} on engine "
                          f"{binding['bundle'].get('engineHash')}: a live night would fail qualification-binding")
        argv = [str(HERE / "../../packages/play/bin/phone/night-run.sh"), "--live", "--confirm-live", "--label", label,
                "--bundle", binding["bundle"]["dir"], "--night", str(night), "--serial", serial,
                "--profile", binding["profile"], "--no-grade"]
        for venue in venues:
            argv += ["--venue-binding", str(venue)]
        argv += ["--qualification", str(qualification)]
        if audio:
            argv.append("--bt-audio")
        return argv, {"FNAF_LEASE_HELD": "1", "FNAF_SERIAL": serial}
    if game == "fnaf4":
        options = winner.get("resolvedOptions") or {}
        argv = [str(HERE / "../../packages/play/games/fnaf4/fnaf4-run.sh"), "--live", "--confirm-live", "--mode", "loop",
                "--detectors", str(expand_home(winner["detectors"]["file"])), "--night", str(night),
                "--label", label, "--stop-after-ms", str(binding["nightMs"])]
        if options.get("teach"):
            argv.append("--teach")
        if options.get("video"):
            argv.append("--video")
        return argv, {"FNAF4_LEASE_HELD": "1", "FNAF_SERIAL": serial}
    argv = ["node", str(HERE / "../../packages/play/games/fnaf1/fnaf1-winner.ts"), "--winner", binding["winner"], "--live", "--confirm-live",
            "--label", label]
    return argv, {"FNAF_SERIAL": serial}


RUN_ID = {
    "fnaf2": re.compile(r"^run\s+(night\d-[a-z0-9-]+-\d{8}T\d{6}Z)\s*$", re.M),
    "fnaf4": re.compile(r"^fnaf4 run (fnaf4-[A-Za-z0-9-]+):", re.M),
    "fnaf1": re.compile(r"^fnaf1-winner: (fnaf1-custom-[A-Za-z0-9-]+) is a replay of", re.M),
}


def run_id_from(game: str, output: str) -> str | None:
    match = RUN_ID[game].search(output)
    return match.group(1) if match else None


def terminal_of(game: str, run_id: str | None, runs_root: Path) -> dict:
    """How the night ended, read from the runner's own record; UNKNOWN if none says."""
    if not run_id:
        return {"outcome": "UNKNOWN", "reason": "no run id"}
    run_dir = runs_root / "artifacts" / "runs" / run_id
    if game == "fnaf2":
        try:
            log = (run_dir / "campaign.log").read_text(encoding="utf-8", errors="replace")
        except OSError:
            return {"outcome": "UNKNOWN", "reason": "no campaign.log"}
        halts = log.count('"type":"lifecycle.actuation-halted"')
        dirs = re.findall(r'"type":"evidence.started","evidenceDirectory":"([^"]+)"', log)
        for directory in reversed(dirs):
            try:
                result = json.loads((Path(directory) / "result.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            attempts = (result.get("result") or {}).get("attempts") or []
            if attempts:
                terminal = attempts[-1].get("terminal") or {}
                return {"outcome": terminal.get("outcome") or "UNKNOWN", "status": attempts[-1].get("status"),
                        "staticHalts": halts, "campaign": directory}
        return {"outcome": "UNKNOWN", "reason": "no campaign result", "staticHalts": halts}
    if game == "fnaf4":
        try:
            record = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"outcome": "UNKNOWN", "reason": "no run.json"}
        return {"outcome": record.get("status") or "UNKNOWN", "record": str(run_dir / "run.json")}
    return {"outcome": "UNKNOWN", "reason": "the FNaF 1 replay's terminal is read from its pack"}


def ran_to_terminal(game: str, terminal: dict, runner_exit: int) -> bool:
    """The night was played to an end the runner recorded: a job DONE, even a death."""
    if game == "fnaf2":
        return terminal.get("outcome") in ("sixam", "death")
    if game == "fnaf4":
        return terminal.get("outcome") == "COMPLETE"
    return runner_exit == 0
