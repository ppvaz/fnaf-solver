#!/bin/bash
# Gate for the session producer. Mock adb, synthetic artifacts, no phone.
#
# This drives the real shell entry points the runners call -- fnaf_session_begin,
# probe_target, record, event, artifact, finalize -- so everything except the
# adb round trips is the shipped code path.
#
# What it is actually asserting, and why each one has a control:
#
#   * a session validates end to end, AND the same session with one fact
#     removed fails. A validator that accepts everything and a producer that
#     emits nothing look identical from a single passing run.
#   * the cross-clock event passes *because* the alignment edge exists: the
#     control disables the device-clock probe and the same event is refused
#     with clock-alignment-missing.
#   * an artifact's sha256 is the file's sha256, checked against an independent
#     digest rather than against itself.
#   * a file that was never written becomes a fault event, never an entry. A
#     manifest that names a file nobody wrote is the failure grade-run.sh
#     exists for.
#   * finalize keeps the spool when the manifest does not validate. A silently
#     discarded spool would leave no evidence that a session was attempted.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
# Inside the checkout on purpose: artifact paths are recorded repo-relative.
# captures/ is gitignored, so a fresh clone does not have it. Without this
# mkdir, mktemp failed, WORK was empty, and every write in this file landed on
# "/" -- which on CI is a wall of "Permission denied" that names no defect.
mkdir -p "$REPO/captures"
WORK="$(mktemp -d "$REPO/captures/test-session.XXXXXX")" || exit 1
trap 'rm -rf "$WORK"' EXIT
export FNAF2_CAPTURES="$WORK"

failed=0
check() {                                       # name condition-description
  if [ "$2" = 0 ]; then echo "  ok   $1"; else echo "  FAIL $1"; failed=1; fi
}
say() { echo; echo "--- $1 ---"; }

mkdir -p "$WORK/bin"
cat > "$WORK/bin/adb" <<'MOCK'
#!/bin/bash
case "$*" in
  "shell dumpsys package com.scottgames.fnaf2")
    printf '    versionName=%s\n    versionCode=%s minSdk=21 targetSdk=33\n' \
      "${MOCK_VERSION:-2.0.7}" "${MOCK_CODE:-26}"; exit 0 ;;
  "shell getprop ro.product.model") printf '%s\n' "${MOCK_MODEL:-moto g56 5G}"; exit 0 ;;
  "shell wm size") printf 'Physical size: 1080x2400\n'; exit 0 ;;
  "shell date +%s%3N")
    [ "${MOCK_NO_CLOCK:-0}" = 1 ] && exit 1
    python3 -c 'import time;print(int(time.time()*1000))'; exit 0 ;;
esac
echo "unexpected mock adb invocation: $*" >&2
exit 1
MOCK
chmod +x "$WORK/bin/adb"
export PATH="$WORK/bin:$PATH"

# A stand-in for every binary artifact: the test never touches game media.
printf 'synthetic capture bytes\n' > "$WORK/fake.mp4"
printf 'driver stdout\ndriver stderr\n' > "$WORK/fake-run.log"
printf 'epoch_ms=1787700000123 previous_clear_ms=1787699999000 bracket_ms=1123\n' \
  > "$WORK/fake-epoch.txt"
printf 'synthetic model bytes\n' > "$WORK/fake.scm"
printf 'a 1\nb 2\n' > "$WORK/fake-plan.txt"

# One helper so each scenario is a fresh session driven through the real API.
# MODEL_BUILD and NO_CLOCK are the knobs the controls turn.
build_session() {                               # RUN LIFECYCLE
  local run=$1 lifecycle=$2
  (
    set +e
    unset FNAF2_SESSION_RUN FNAF2_SESSION_ID
    export MOCK_NO_CLOCK="${NO_CLOCK:-0}"
    # shellcheck source=/dev/null
    source "$HERE/session.sh"
    fnaf_session_begin "$run" "packages/play/bin/companion/collect-cue-audio.sh" || exit 9
    fnaf_session_probe_target 6 "6th-hid-multi-c6" "screencap-raw+screenrecord"
    fnaf_session_record controller \
      "policy_version=trial/6th/hid-multi" \
      "plan_id=recipe.mjs --device-plan" "plan_file=$WORK/fake-plan.txt" \
      actuator=hid-multi emitted_action_trace=null
    fnaf_session_record model model_id=bb-left kind=scm1-left-opening \
      "file=$WORK/fake.scm" built_from_commit=unknown authorized_for=fail-safe \
      "authorized_for_game_build=${MODEL_BUILD:-$FNAF2_CALIBRATED_BUILD}" \
      calibration_report=null holdout_report=null
    fnaf_session_event kind=lifecycle outcome=title terminal=false \
      sensor=window-manager "note=launched"
    # The cross-clock record: the device's own reading, kept raw.
    if [ -n "${FNAF2_SESSION_DEVICE_OFFSET:-}" ]; then
      fnaf_session_event kind=lifecycle outcome=night terminal=false \
        sensor=screencheck source_clock=device_shell_wall_ms \
        source_t=1787700000123 "note=device epoch latched"
    else
      fnaf_session_event kind=lifecycle outcome=night terminal=false \
        sensor=screencheck "note=device epoch latched, unaligned"
    fi
    [ "${FORCE_CROSS_CLOCK:-0}" = 0 ] || \
      fnaf_session_event kind=lifecycle outcome=night terminal=false \
        sensor=screencheck source_clock=device_shell_wall_ms \
        source_t=1787700000123 "note=forced cross-clock reading"
    fnaf_session_artifact "$WORK/fake.mp4" artifact_id=video role=night-recording \
      authority=primary-observation format=video/mp4 complete=true truncated=false \
      retention=local-only clock_domain=video_media_pts_s \
      redaction.contains_game_media=true redaction.contains_audio=false \
      redaction.commit_safe=false
    fnaf_session_artifact "$WORK/fake-run.log" artifact_id=driver-log \
      role=remote-driver-output authority=operational-metadata format=text/plain \
      complete=true truncated=false retention=local-only clock_domain=null \
      redaction.contains_game_media=false redaction.contains_audio=false \
      redaction.commit_safe=true
    fnaf_session_record clock domain=video_media_pts_s kind=media-pts units=s \
      "origin_note=synthetic" valid_from=0 valid_until=60
    fnaf_session_artifact "$WORK/never-written.jsonl" artifact_id=hid-trace \
      role=emitted-input-trace authority=emitted-action-record \
      format=application/x-ndjson complete=true truncated=false \
      retention=local-only clock_domain=null \
      redaction.contains_game_media=false redaction.contains_audio=false \
      redaction.commit_safe=true
    fnaf_session_finalize "$lifecycle" "synthetic $lifecycle"
    echo "finalize_exit=$?"
  ) > "$WORK/$1.log" 2>&1
}

# ---------------------------------------------------------------- 1. it works
say "a complete session validates end to end"
build_session ok-run unknown
grep -q 'finalize_exit=0' "$WORK/ok-run.log"; check "finalize succeeded" $?
[ -f "$WORK/ok-run-session.json" ]; check "manifest written" $?
python3 "$HERE/../../../../tools/device/validate-session.py" "$WORK/ok-run-session.json" >/dev/null 2>&1
check "validate-session.py accepts it" $?
[ ! -f "$WORK/ok-run-session.spool.jsonl" ]
check "spool removed once the manifest validated" $?

# One id, latched once. The manifest must carry exactly what begin exported,
# and it must not be re-derivable from the run name.
manifest_id=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["session"]["session_id"])' \
  "$WORK/ok-run-session.json")
grep -q "manifest: session $manifest_id" "$WORK/ok-run.log"
check "the manifest's session id is the one begin exported" $?
[ "$manifest_id" != "ok-run" ]; check "the id is not just the run name" $?

# ------------------------------------------------- 2. hashes, not filenames
say "artifacts carry the bytes' own digest"
expected=$(python3 -c 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' \
  "$WORK/fake.mp4")
recorded=$(python3 - "$WORK/ok-run-session.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
print(next(a["sha256"] for a in m["artifacts"] if a["artifact_id"] == "video"))
PY
)
[ "$expected" = "$recorded" ]; check "video sha256 matches an independent digest" $?
model_hash=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["models"][0]["sha256"])' \
  "$WORK/ok-run-session.json")
[ -n "$model_hash" ] && [ "$model_hash" != "null" ]
check "the model is recorded by hash" $?

say "a file that was never written is a fault, not an artifact"
python3 - "$WORK/ok-run-session.json" "$WORK/ok-run-session.events.jsonl" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
ids = {a["artifact_id"] for a in m["artifacts"]}
assert "hid-trace" not in ids, "an absent file was recorded as an artifact"
events = [json.loads(l) for l in open(sys.argv[2]) if l.strip()]
kinds = [(e.get("fault") or {}).get("fault_kind") for e in events]
assert "artifact-absent" in kinds, kinds
PY
check "absent capture recorded as an artifact-absent fault" $?

# ------------------------------------------------------- 3. the clock control
say "the cross-clock event passes because of the alignment edge, not by luck"
python3 - "$WORK/ok-run-session.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
edges = [(e["from_domain"], e["to_domain"]) for e in m["alignment_edges"]]
assert ("device_shell_wall_ms", "host_monotonic_ms") in edges, edges
edge = m["alignment_edges"][0]
assert edge["residual"] >= 0 and edge["offset_units"] == "ms", edge
PY
check "a measured device->host edge is present with its residual" $?

# Control A: the device clock was never read, so the domain is not even
# declared. A cross-clock reading against it must not pass as ordinary data.
NO_CLOCK=1 FORCE_CROSS_CLOCK=1 build_session no-clock-run unknown
grep -q 'finalize_exit=1' "$WORK/no-clock-run.log"
check "finalize refuses a session whose device clock was never read" $?
grep -q 'unknown-clock-domain' "$WORK/no-clock-run.log"
check "and names the undeclared domain, not something generic" $?
[ -f "$WORK/no-clock-run-session.spool.jsonl" ]
check "the spool is kept so the defect is recoverable" $?

# Control B isolates the edge itself: take the manifest that passed, delete
# only its alignment edges, and the same event must now be refused. Without
# this, "it validated" would not distinguish an edge that is load-bearing from
# an edge nothing consults.
python3 - "$WORK/ok-run-session.json" "$WORK/no-edge.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
m["alignment_edges"] = []
json.dump(m, open(sys.argv[2], "w"))
PY
python3 "$HERE/../../../../tools/device/validate-session.py" "$WORK/no-edge.json" \
  --events "$WORK/ok-run-session.events.jsonl" >"$WORK/no-edge.log" 2>&1
[ $? -ne 0 ]; check "deleting the alignment edge breaks the same session" $?
grep -q 'clock-alignment-missing' "$WORK/no-edge.log"
check "and it breaks with clock-alignment-missing" $?

# ------------------------------------------------------- 4. the model control
say "a model authorized for another build is caught"
MODEL_BUILD=1.9.9+1 build_session stale-run unknown
grep -q 'finalize_exit=1' "$WORK/stale-run.log"; check "finalize refuses it" $?
grep -q 'model-stale' "$WORK/stale-run.log"; check "with model-stale" $?

# ------------------------------------------------------ 5. every exit path
say "an aborted session is finalized, and says so"
build_session abort-run aborted
grep -q 'finalize_exit=0' "$WORK/abort-run.log"; check "finalize succeeded" $?
python3 - "$WORK/abort-run-session.json" "$WORK/abort-run-session.events.jsonl" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
assert m["outcome"]["lifecycle"] == "aborted", m["outcome"]
assert m["outcome"]["terminal"] is True, m["outcome"]
assert m["outcome"]["evidence"], m["outcome"]
events = [json.loads(l) for l in open(sys.argv[2]) if l.strip()]
terminal = [e for e in events if e.get("terminal")]
assert len(terminal) == 1 and terminal[0]["outcome"] == "aborted", terminal
PY
check "outcome aborted, terminal, with one matching terminal event" $?

# The success path must NOT claim survival. Completing the cycles says nothing
# about whether the game was alive, and a runner that wrote `win` here is the
# 163 s record in machine-readable form.
python3 -c '
import json,sys
m=json.load(open(sys.argv[1]))
assert m["outcome"]["lifecycle"]=="unknown", m["outcome"]
assert m["outcome"]["terminal"] is False, m["outcome"]
' "$WORK/ok-run-session.json"
check "a completed run is 'unknown', never 'win'" $?

# ------------------------------------------------------------ 6. refusals
say "secrets and private paths never reach a manifest"
python3 "$HERE/../../../../tools/device/session-manifest.py" record ok-run env CUE_HELPER_TOKEN=abc123 \
  >/dev/null 2>&1
[ $? -ne 0 ]; check "a credential-shaped env key is refused" $?
python3 "$HERE/../../../../tools/device/session-manifest.py" record ok-run note text=/Users/someone/secret \
  >/dev/null 2>&1
[ $? -ne 0 ]; check "an absolute private path is refused" $?
grep -q '/Users/' "$WORK/ok-run-session.json"
[ $? -ne 0 ]; check "no private path survived into the manifest" $?
python3 "$HERE/../../../../tools/device/session-manifest.py" record ok-run target not_a_field=1 \
  >/dev/null 2>&1
[ $? -ne 0 ]; check "a key the schema does not define is refused at record time" $?

# ---------------------------------------------------------- 7. structural
# The producers must actually call this, on the paths that matter. A helper
# nobody invokes is the "instrument nobody runs" failure with extra steps.
say "the producers are wired to it"
grep -q 'source "$HERE/../phone/session.sh"' "$HERE/../companion/collect-cue-audio.sh"
check "collect-cue-audio.sh sources session.sh" $?
grep -q 'fnaf_session_begin "$LABEL"' "$HERE/../companion/collect-cue-audio.sh"
check "collect-cue-audio.sh begins one session for the collection" $?
grep -q 'fnaf_session_finalize' "$HERE/../companion/collect-cue-audio.sh"
check "collect-cue-audio.sh finalizes its session" $?

echo
if [ "$failed" -eq 0 ]; then
  echo "session producer: manifests validate, hashes are the files', the clock" \
       "edge is load-bearing, absent captures are faults, and every exit path" \
       "finalizes"
else
  echo "session producer: FAILURES above"
fi
exit "$failed"
