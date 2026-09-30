/**
 * The on-device shell script that carries a compiled HID schedule to
 * `/system/bin/hid`: bounded paths, bounded sleeps, one append per stream
 * file. It never accepts shell text from a caller. Split out of
 * adb-device-local-executor.js on 2026-09-25.
 */
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new TypeError(`adb device-local executor: ${message}`); };

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function boundedRemotePath(value, label) {
  if (typeof value !== 'string' ||
      !/^\/data\/local\/tmp\/fnaf2-modern-(?:start|go|retry|fail|rearm|night-go|gate-go|gate-fix)-[A-Za-z0-9._$-]+$/.test(value))
    fail(`${label} is not a bounded device-local control path`);
  return value;
}

function shellSleepMs(milliseconds) {
  if (!Number.isInteger(milliseconds) || milliseconds < 1 || milliseconds > 30000)
    fail('device-local setup delay is outside 1..30000');
  return `sleep ${milliseconds / 1000}`;
}

function appendWrites(lines, path, values) {
  lines.push(`rm -f ${path}`, `: > ${path}`);
  if (values.length === 0) return;
  // One printf per file, not one per line. `printf '%s\n' a b c` reuses its
  // format for every argument, so the whole stream is a single process and a
  // single open/append/close instead of several hundred of them. The per-line
  // form cost ~25 s on the phone before `/system/bin/hid` was even registered,
  // which is the whole of the measured office-to-start-marker latency: the
  // schedule spawned 8.7 s before the office and still did not begin for
  // another 23 s (2026-09-09 instrumented run). On Night 5 that delay is
  // 0/3000 in the model, and the device died to an exhausted music box.
  lines.push(`printf '%s\\n' ${values.map(value => shellQuote(value)).join(' ')} >> ${path}`);
}

export function renderDeviceLocalScript(schedule, { startMarker = '/data/local/tmp/fnaf2-modern-start-$$', armControl = null } = {}) {
  if (!schedule || schedule.schema !== 'device-local-hid-schedule-v1' ||
      !Array.isArray(schedule.lines))
    fail('render requires a compiled device-local HID schedule');
  boundedRemotePath(startMarker, 'render startMarker');
  if (armControl !== null) {
    if (!isRecord(armControl)) fail('render armControl must be an object');
    for (const key of ['go', 'retry', 'fail', 'rearm', 'nightGo', 'gateGo', 'gateFix'])
      boundedRemotePath(armControl[key], `render armControl.${key}`);
  }
  if (schedule.gated && armControl === null)
    fail('gated arm schedule requires render armControl');
  if (!schedule.gated && armControl !== null)
    fail('render armControl requires a gated arm schedule');
  // Android 16's shell domain denies named-pipe creation in /data/local/tmp.
  // A regular file is sufficient here: the complete bounded stream is
  // written before hid starts, and hid owns every inter-action delay locally.
  const stream = '/data/local/tmp/fnaf2-modern-hid-$$.jsonl';
  if (!schedule.gated) {
    const writes = schedule.lines.map(value => `printf '%s\\n' ${shellQuote(value)} >> "$stream"`).join('\n');
    return [
    'set -eu',
    // `stream` is a fixed path prefix; leave the shell PID expansion active so
    // two bounded executor processes cannot share a remote stream file.
    `stream=${stream}`,
    `start_marker=${startMarker}`,
    'hid_pid=',
    'cleanup() {',
    '  set +e',
    '  [ -z "$hid_pid" ] || kill "$hid_pid" 2>/dev/null',
    '  [ -z "$hid_pid" ] || wait "$hid_pid" 2>/dev/null',
    '  rm -f "$start_marker"',
    '  rm -f "$stream"',
    '}',
    'trap cleanup EXIT HUP INT TERM',
    'rm -f "$stream"',
    ': > "$stream"',
    writes,
    'rm -f "$start_marker"',
    // Anchor the host verifier to the phone-side HID launch, not to the ADB
    // process spawn. The stream's ready delay starts only after this point.
    ': > "$start_marker"',
    '/system/bin/hid - < "$stream" >/dev/null &',
    'hid_pid=$!',
    'wait "$hid_pid"',
    'hid_pid=',
    'rm -f "$stream"',
    '',
    ].join('\n');
  }

  const gated = schedule.gated;
  const { go, retry, fail: failed, rearm, nightGo, gateGo, gateFix } = armControl;
  const armPrefix = '/data/local/tmp/fnaf2-modern-arm-prefix-$$.jsonl';
  const segmentDir = '/data/local/tmp/fnaf2-modern-seg-$$';
  const gateCorrection = '/data/local/tmp/fnaf2-modern-gate-fix-$$.jsonl';
  const armRetry = '/data/local/tmp/fnaf2-modern-arm-rearm-$$.jsonl';
  const lines = [
    'set -eu',
    `arm_prefix=${armPrefix}`,
    `seg_dir=${segmentDir}`,
    `gate_correction=${gateCorrection}`,
    `arm_retry=${armRetry}`,
    `start_marker=${startMarker}`,
    `arm_go=${go}`,
    `arm_retry_signal=${retry}`,
    `arm_fail=${failed}`,
    `arm_rearm=${rearm}`,
    `night_go=${nightGo}`,
    `gate_go=${gateGo}`,
    `gate_fix=${gateFix}`,
    `seg_total=${gated.remainderSegments.length}`,
    'hid_pid=',
    'cleanup() {',
    '  set +e',
    '  [ -z "$hid_pid" ] || kill "$hid_pid" 2>/dev/null',
    '  [ -z "$hid_pid" ] || wait "$hid_pid" 2>/dev/null',
    '  rm -f "$start_marker" "$arm_go" "$arm_retry_signal" "$arm_fail" "$arm_rearm" "$night_go"',
    '  rm -f "$gate_go" "$gate_fix" "$gate_correction"',
    '  rm -f "$arm_prefix" "$arm_retry"',
    '  rm -rf "$seg_dir"',
    '}',
    'trap cleanup EXIT HUP INT TERM',
  ];
  appendWrites(lines, '"$arm_prefix"', gated.prefix);
  appendWrites(lines, '"$arm_retry"', gated.rearm);
  appendWrites(lines, '"$gate_correction"', gated.maskCorrection ?? []);
  lines.push('rm -rf "$seg_dir"', 'mkdir -p "$seg_dir"');
  gated.remainderSegments.forEach((events, index) =>
    appendWrites(lines, `"$seg_dir/seg-${String(index).padStart(3, '0')}.jsonl"`, events));
  lines.push(
    'rm -f "$start_marker" "$arm_go" "$arm_retry_signal" "$arm_fail" "$arm_rearm" "$night_go"',
    'rm -f "$gate_go" "$gate_fix"',
    // The setup delay happens after the registration line has reached hid.
    // The marker therefore means "the first authored gameplay action is
    // about to be emitted", not merely "the adb shell was spawned".
    '(',
    `  printf '%s\\n' ${shellQuote(gated.register)}`,
    `  ${shellSleepMs(schedule.readyDelayMs)}`,
    '  : > "$start_marker"',
    // The grid anchor: no plan-relative action may run before the office HUD
    // exists. The host lifecycle observer touches night_go on the first
    // positively observed night frame, aligning the timeline's origin to
    // 12 AM within one poll instead of the measured 30-37 s post-intro
    // spawn offset (2026-09-07 runs: the Night 2 Foxy death). Bounded at
    // 120 s so a night that never starts fails instead of hanging.
    '  night_waits=0',
    '  while [ ! -e "$night_go" ] && [ ! -e "$arm_fail" ]; do',
    '    night_waits=$((night_waits+1))',
    '    if [ "$night_waits" -ge 2400 ]; then',
    '      : > "$arm_fail"',
    '      break',
    '    fi',
    '    sleep 0.05',
    '  done',
    '  cat "$arm_prefix"',
    '  while [ ! -e "$arm_go" ] && [ ! -e "$arm_fail" ]; do',
    '    if [ -e "$arm_retry_signal" ]; then',
    '      rm -f "$arm_retry_signal"',
    '      cat "$arm_retry"',
    '    else',
    '      sleep 0.05',
    '    fi',
    '  done',
    // Each segment ends parked on a cycle boundary the plan already idles
    // through. The host owns that budget: it observes the mask parity, emits
    // the authored corrective press through `gate_fix` if the device
    // disagrees with the plan, and releases with `gate_go`. The stream never
    // advances on its own here, so a host that goes quiet stops the night
    // instead of running it blind.
    '  if [ -e "$arm_go" ]; then',
    '    seg_index=0',
    '    for seg in "$seg_dir"/seg-*.jsonl; do',
    '      cat "$seg"',
    '      seg_index=$((seg_index+1))',
    '      [ "$seg_index" -ge "$seg_total" ] && break',
    '      while [ ! -e "$gate_go" ] && [ ! -e "$arm_fail" ]; do',
    '        if [ -e "$gate_fix" ]; then',
    '          rm -f "$gate_fix"',
    '          cat "$gate_correction"',
    '        else',
    '          sleep 0.02',
    '        fi',
    '      done',
    '      [ -e "$arm_fail" ] && break',
    '      rm -f "$gate_go"',
    '    done',
    '  fi',
    ') | /system/bin/hid - >/dev/null &',
    'hid_pid=$!',
    'wait "$hid_pid"',
    'hid_pid=',
    '',
  );
  return lines.join('\n');
}
