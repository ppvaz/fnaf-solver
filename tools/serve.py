#!/usr/bin/env python3
"""Dev server for the trainer.

Serves the project on this machine only (127.0.0.1) and accepts POST
/save-layout, so a layout calibrated by dragging can be written back into the
core config as the new DEFAULT_MAP; it rebuilds dist/ afterwards so a reload
picks it up. POST /save-trace records a coached run under captures/traces/.

Both POSTs write to this machine, and /save-layout rewrites a source file of
@sixam/core. So until 2026-09-29, when this bound 0.0.0.0, anyone on the
network could rewrite packages/source/src/games/fnaf2/config.js. Now the socket is
loopback only, and a write is refused unless its client is loopback, its Host
names this machine, and any Origin is the page's own (write_refusal): a web
page in the host's browser can reach 127.0.0.1 too, and must not write here.

To calibrate on a phone, forward the port over USB rather than opening it to
the network: `adb reverse tcp:8731 tcp:8731`, then open
http://localhost:8731/index.html on the phone. Its requests arrive from
loopback, and localhost is a secure context, so wake lock and vibration work.

    python3 tools/serve.py [port]
"""
import datetime, ipaddress, json, os, re, subprocess, sys, pathlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Loopback only. There is deliberately no LAN switch: the writes are this
# machine's, and a phone reaches the server through `adb reverse` (above).
HOST = '127.0.0.1'
LOOPBACK_NAMES = {'localhost', '127.0.0.1', '::1'}

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'packages' / 'source' / 'src' / 'games' / 'fnaf2' / 'config.js'
# Where POST /save-trace lands. captures/ is ignored, like every other run
# artifact; the env override exists so tests can exercise the real write
# without littering the repository.
TRACES = pathlib.Path(os.environ.get('FNAF_TRACE_DIR', ROOT / 'captures' / 'traces'))
MAP_BLOCK = re.compile(r"export const DEFAULT_MAP = \{.*?\n\};\n", re.S)
WID_BLOCK = re.compile(r"export const DEFAULT_WIDGETS = \{.*?\n\};\n", re.S)
VALID = set(range(1, 13))
WIDGETS = {'light', 'camlight', 'mask', 'monitor', 'ventL', 'ventR', 'wind'}
SPACES = {'light': 'stage', 'camlight': 'stage', 'mask': 'stage', 'monitor': 'stage',
          'ventL': 'stage', 'ventR': 'stage', 'wind': 'feed'}


def validate(m):
    if not isinstance(m, dict) or set(map(int, m)) != VALID:
        raise ValueError(f'expected exactly cams 1-12, got {sorted(map(int, m))}')
    out = {}
    for k, v in m.items():
        r = {f: float(v[f]) for f in ('x', 'y', 'w', 'h')}
        if not all(0 <= r[f] <= 1 for f in r):
            raise ValueError(f'cam {k}: values must be 0..1, got {r}')
        if r['w'] <= 0 or r['h'] <= 0:
            raise ValueError(f'cam {k}: width and height must be positive')
        out[int(k)] = r
    return out


def validate_widgets(w):
    if not isinstance(w, dict) or set(w) != WIDGETS:
        raise ValueError(f'expected widgets {sorted(WIDGETS)}, got {sorted(w or {})}')
    out = {}
    for k, v in w.items():
        r = {f: float(v[f]) for f in ('x', 'y', 'w', 'h')}
        if not all(0 <= r[f] <= 1 for f in r):
            raise ValueError(f'widget {k}: values must be 0..1, got {r}')
        if r['w'] <= 0 or r['h'] <= 0:
            raise ValueError(f'widget {k}: width and height must be positive')
        # `space` is structural; it is never taken from the client.
        r['space'] = SPACES[k]
        out[k] = r
    return out


def write_config(m, w):
    src = CONFIG.read_text()
    for name, block in (('DEFAULT_MAP', MAP_BLOCK), ('DEFAULT_WIDGETS', WID_BLOCK)):
        if not block.search(src):
            raise RuntimeError(f'{name} block not found in canonical core config')
    rows = '\n'.join(
        f"  {k}:{' ' * (2 - len(str(k)))} {{ x: {m[k]['x']:.3f}, y: {m[k]['y']:.3f}, "
        f"w: {m[k]['w']:.3f}, h: {m[k]['h']:.3f} }},"
        for k in sorted(m))
    src = MAP_BLOCK.sub(f"export const DEFAULT_MAP = {{\n{rows}\n}};\n", src)

    pad = max(len(k) for k in w)
    wrows = '\n'.join(
        f"  {k + ':':<{pad + 1}} {{ space: '{w[k]['space']}',{' ' if w[k]['space'] == 'feed' else ''} "
        f"x: {w[k]['x']:.3f}, y: {w[k]['y']:.3f}, w: {w[k]['w']:.3f}, h: {w[k]['h']:.3f} }},"
        for k in sorted(w))
    src = WID_BLOCK.sub(f"export const DEFAULT_WIDGETS = {{\n{wrows}\n}};\n", src)
    CONFIG.write_text(src)


def validate_trace(data):
    if data.get('v') != 1:
        raise ValueError(f"unknown trace version {data.get('v')!r}")
    lesson = str(data.get('lesson') or '')
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,40}', lesson):
        raise ValueError(f'bad lesson id {lesson!r}')
    steps = data.get('steps')
    if not isinstance(steps, list) or not steps:
        raise ValueError('steps must be a non-empty list')
    for s in steps:
        if not isinstance(s, dict) or 'stepId' not in s or 'grade' not in s:
            raise ValueError('every step row needs stepId and grade')
    return lesson


def repo_commit():
    try:
        head = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT,
                              capture_output=True, text=True, check=True).stdout.strip()
        dirty = subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT,
                               capture_output=True, text=True, check=True).stdout.strip()
        return head + ('+' if dirty else '')
    except Exception:
        return 'unknown'


def write_trace(data, lesson):
    # Provenance is stamped at save time, not left to the client: the lateness
    # band that needed a retroactive parasite-era caveat was measured under
    # conditions nobody recorded. Never again.
    data['savedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    data['commit'] = repo_commit()
    TRACES.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')
    for n in range(100):
        path = TRACES / f"{stamp}-{lesson}{f'-{n}' if n else ''}.json"
        try:
            with open(path, 'x') as f:
                json.dump(data, f)
            return path
        except FileExistsError:
            continue
    raise RuntimeError('could not find a free trace filename')


def _is_loopback(address):
    try:
        ip = ipaddress.ip_address(address.split('%')[0])
    except ValueError:
        return False
    return ip.is_loopback or bool(getattr(ip, 'ipv4_mapped', None) and ip.ipv4_mapped.is_loopback)


def _host_name(host):
    """The hostname of a Host header value: `localhost:8731`, `[::1]:8731`."""
    if host.startswith('['):
        return host[1:host.find(']')] if ']' in host else host
    return host.rsplit(':', 1)[0] if host.count(':') == 1 else host


def write_refusal(client, host, origin):
    """Why a POST may not write here, or None when it may.

    client: the peer address; host, origin: the request's Host and Origin
    headers (None when absent). A write needs a loopback client (the socket is
    loopback already; this holds if that ever changes), a Host naming this
    machine (a DNS-rebound name is not), and, when the client is a browser
    that sent an Origin, that Origin to be the page's own: http:// plus Host.
    """
    if not _is_loopback(client):
        return f'writes are accepted from this machine only, not from {client}'
    if not host or _host_name(host.strip().lower()) not in LOOPBACK_NAMES:
        return f'Host {host!r} does not name this machine'
    if origin is not None and origin.strip().lower() != f'http://{host.strip().lower()}':
        return f'a page from {origin!r} may not write to http://{host}'
    return None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def _json(self, code, payload):
        # No Access-Control-Allow-Origin: the writes are same-origin only, and
        # nothing on another origin has any business reading their answers.
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        refusal = write_refusal(self.client_address[0], self.headers.get('Host'), self.headers.get('Origin'))
        if refusal:
            print(f'{self.path} refused: {refusal}')
            return self._json(403, {'error': refusal})
        if self.path == '/save-trace':
            return self.save_trace()
        if self.path != '/save-layout':
            return self._json(404, {'error': 'not found'})
        try:
            n = int(self.headers.get('Content-Length', 0))
            data = json.loads(self.rfile.read(n) or b'{}')
            m = validate(data.get('map'))
            w = validate_widgets(data.get('widgets'))
            if data.get('dry'):
                # Validate and report without touching the file, so automated
                # tests can exercise this path without editing the repo.
                print('save-layout: dry run ok')
                return self._json(200, {'ok': True, 'dry': True, 'build': '(dry run, not written)'})
            write_config(m, w)
            build = subprocess.run([sys.executable, str(ROOT / 'tools' / 'build.py')],
                                   capture_output=True, text=True)
            print(f'saved layout -> packages/source/src/games/fnaf2/config.js  ({build.stdout.strip()})')
            self._json(200, {'ok': True, 'build': build.stdout.strip()})
        except Exception as e:
            print(f'save-layout failed: {e}')
            self._json(400, {'error': str(e)})

    def save_trace(self):
        try:
            n = int(self.headers.get('Content-Length', 0))
            if n > 4_000_000:
                raise ValueError(f'trace too large ({n} bytes)')
            data = json.loads(self.rfile.read(n) or b'{}')
            lesson = validate_trace(data)
            if data.get('dry'):
                # Validation without a write: automated browser runs post dry
                # so a bot's perfectly timed presses never enter the census.
                print(f'save-trace: dry run ok ({lesson})')
                return self._json(200, {'ok': True, 'dry': True})
            path = write_trace(data, lesson)
            print(f'saved trace -> {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}')
            self._json(200, {'ok': True, 'file': path.name})
        except Exception as e:
            print(f'save-trace failed: {e}')
            self._json(400, {'error': str(e)})

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        first = args[0] if args else ''
        if 'save-layout' in first or 'save-trace' in first:
            super().log_message(fmt, *args)


def make_server(port, host=HOST):
    return ThreadingHTTPServer((host, port), Handler)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8731
    server = make_server(port)
    print(f'serving {ROOT} on http://{HOST}:{server.server_address[1]}/ (this machine only)')
    server.serve_forever()
