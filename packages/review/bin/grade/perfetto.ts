// Shared Perfetto query projection, executable lookup and process/UTF-8 boundary for the two evidence readers.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { delimiter, join } from 'node:path';
import { present } from '@sixam/kernel';
import { pyDecodeUtf8, pySplitLines } from '@sixam/kernel/py';

export const DISPATCH_RE = /^dispatchInputEvent MotionEvent ACTION_(?<action>[A-Z_]+(?:\(\p{Nd}+\))?) deviceId=(?<device_id>-?\p{Nd}+) source=(?<source>0x[0-9a-fA-F]+) historySize=(?<history_size>\p{Nd}+)(?=\n?$)/u;
export const QUERY_PREFIX = "\nWITH joined AS (\n  SELECT\n    s.ts AS ts_ns,\n    s.dur AS dur_ns,\n    s.name AS name,\n    COALESCE(th.name, '') AS thread_name,\n    COALESCE(p.name, '') AS process_name,\n    COALESCE(t.name, '') AS track_name\n  FROM slice s\n  JOIN track t ON t.id = s.track_id\n  LEFT JOIN thread_track tt ON tt.id = s.track_id\n  LEFT JOIN thread th ON th.utid = tt.utid\n  LEFT JOIN process p ON p.upid = th.upid\n),\napp_joined AS (\n  SELECT * FROM joined\n  WHERE process_name = '{package}' OR INSTR(track_name, '{package}') > 0\n)\nSELECT 'dispatch' AS kind, ts_ns, dur_ns, name, thread_name, process_name, track_name\nFROM app_joined\nWHERE name GLOB 'dispatchInputEvent MotionEvent *'";

/** Escape only the caller's package while retaining the fixed SQL text. */
export function formatQuery(template: string, pkg: string) {
  if (!pkg || pkg.includes('\r') || pkg.includes('\n')) throw new RangeError('package must be a non-empty single line');
  return template.replaceAll('{package}', () => pkg.replaceAll("'", "''"));
}

/** shutil.which for a name or a path, without running it. */
export function which(name: string) {
  const runnable = (file: string) => {
    try { accessSync(file, constants.X_OK); return statSync(file).isFile(); } catch { return false; }
  };
  if (name.includes('/')) return runnable(name);
  return (process.env.PATH ?? '').split(delimiter).some(dir => runnable(join(dir || '.', name)));
}

/** Query bytes become strict UTF-8; a killed processor retains its negative signal number. */
export function queryText(processor: string, trace: string, query: string, refuse: (message: string) => never) {
  const result = spawnSync(processor, ['query', trace, query], { maxBuffer: 1 << 30 });
  if (result.error) refuse('could not execute trace processor: ' + result.error.message);
  const stdout = pyDecodeUtf8(result.stdout), stderr = pyDecodeUtf8(result.stderr);
  const code = result.status ?? -present(Object.entries(osConstants.signals).find(([name]) => name === result.signal), 'exit signal')[1];
  return { stdout, stderr, code };
}

/** Skip trace_processor progress rows before its CSV header. */
export function csvBody(stdout: string, refuse: (message: string) => never) {
  const lines = pySplitLines(stdout);
  const at = lines.findIndex(line => line.startsWith('"kind"') || line.startsWith('kind,'));
  if (at < 0) refuse('trace processor returned no CSV header');
  return lines.slice(at).join('\n');
}
