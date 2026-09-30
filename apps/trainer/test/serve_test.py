#!/usr/bin/env python3
"""Check that serve.py (the trainer's dev server) writes for this machine only.

POST /save-layout rewrites packages/source/src/games/fnaf2/config.js and
/save-trace writes under captures/traces/. Until 2026-09-29 the server bound
0.0.0.0, so anyone on the network could do either. This pins:

  - the socket binds 127.0.0.1 by default,
  - a write from a loopback client with its own Host and Origin is accepted
    (the trainer's same-origin fetch, and a Node or curl client with no Origin),
  - a write is refused (403, nothing written) when a page on another origin
    posts it, when the Host names another machine (DNS rebinding), or when the
    client is not loopback -- the last through write_refusal, since a test
    cannot open a non-loopback connection to a loopback socket,
  - no write answer carries Access-Control-Allow-Origin.

Everything runs as dry runs or against a temporary FNAF_TRACE_DIR; the core
config is never written.

  python3 apps/trainer/test/serve_test.py
"""
import http.client
import importlib.util
import json
import os
import sys
import tempfile
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load_serve(trace_dir):
    os.environ['FNAF_TRACE_DIR'] = trace_dir
    spec = importlib.util.spec_from_file_location('serve_under_test', HERE / 'serve.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def post(port, path, body, headers):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
    data = json.dumps(body).encode()
    connection.putrequest('POST', path, skip_host=True)
    for name, value in {'Content-Type': 'application/json', 'Content-Length': str(len(data)), **headers}.items():
        connection.putheader(name, value)
    connection.endheaders(data)
    response = connection.getresponse()
    answer = (response.status, dict(response.getheaders()), json.loads(response.read() or b'{}'))
    connection.close()
    return answer


def main():
    failures = []

    def check(name, ok, detail=''):
        if not ok:
            failures.append(f'{name} {detail}'.strip())

    with tempfile.TemporaryDirectory() as trace_dir:
        serve = load_serve(trace_dir)
        check('the default bind is loopback', serve.HOST == '127.0.0.1', serve.HOST)

        # write_refusal, one refusal per rule, and the accepted shapes.
        refuse = serve.write_refusal
        check('an off-host client is refused', refuse('192.168.1.20', 'localhost:8731', None) is not None)
        check('an IPv6 off-host client is refused', refuse('fe80::1', 'localhost:8731', None) is not None)
        check('a rebound Host is refused', refuse('127.0.0.1', 'evil.example:8731', None) is not None)
        check('a missing Host is refused', refuse('127.0.0.1', None, None) is not None)
        check('a foreign Origin is refused', refuse('127.0.0.1', 'localhost:8731', 'http://evil.example') is not None)
        check('an opaque Origin is refused', refuse('127.0.0.1', 'localhost:8731', 'null') is not None)
        check('another local port is another origin', refuse('127.0.0.1', 'localhost:8731', 'http://localhost:3000') is not None)
        for client, host, origin in [('127.0.0.1', '127.0.0.1:8731', None), ('127.0.0.1', 'localhost:8731', 'http://localhost:8731'),
                                     ('::1', '[::1]:8731', 'http://[::1]:8731'), ('::ffff:127.0.0.1', 'localhost', None),
                                     ('127.0.0.1', 'localhost:9000', 'http://localhost:9000')]:
            check(f'{client} {host} {origin} may write', refuse(client, host, origin) is None, refuse(client, host, origin))

        server = serve.make_server(0)
        port = server.server_address[1]
        check('the socket is bound to 127.0.0.1', server.server_address[0] == '127.0.0.1', server.server_address)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            connection = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
            connection.request('GET', '/index.html')
            response = connection.getresponse()
            page = response.read()
            check('the trainer is served', response.status == 200)
            check('the page names what this server writes', serve.DEV_META in page and page.count(serve.DEV_META) == 1)
            connection.close()

            trace = {'v': 1, 'lesson': 'cycle', 'steps': [{'stepId': 'a', 'grade': 'ok'}], 'dry': True}
            own = f'127.0.0.1:{port}'
            status, headers, body = post(port, '/save-trace', trace, {'Host': own})
            check('a loopback client with no Origin writes', status == 200 and body.get('dry') is True, (status, body))
            check('no write answer allows other origins', 'Access-Control-Allow-Origin' not in headers, headers)
            status, _, body = post(port, '/save-trace', trace, {'Host': f'localhost:{port}', 'Origin': f'http://localhost:{port}'})
            check('the page\'s own origin writes', status == 200, (status, body))

            real = {**trace, 'dry': False}
            for name, path, headers in [
                ('a foreign page', '/save-trace', {'Host': own, 'Origin': 'http://evil.example'}),
                ('a rebound Host', '/save-trace', {'Host': f'evil.example:{port}'}),
                ('a foreign page on save-layout', '/save-layout', {'Host': own, 'Origin': 'https://evil.example'}),
                ('a rebound Host on save-layout', '/save-layout', {'Host': f'evil.example:{port}'}),
            ]:
                status, _, body = post(port, path, real, headers)
                check(f'{name} is refused', status == 403 and 'error' in body, (status, body))
            check('a refused write wrote nothing', os.listdir(trace_dir) == [], os.listdir(trace_dir))
        finally:
            server.shutdown()
            server.server_close()

    if failures:
        for failure in failures:
            print(f'FAIL {failure}', file=sys.stderr)
        return 1
    print('serve: binds 127.0.0.1, writes from this machine\'s own page or a loopback client, refuses a foreign '
          'origin, a rebound Host and an off-host client, and sends no Access-Control-Allow-Origin')
    return 0


if __name__ == '__main__':
    sys.exit(main())
