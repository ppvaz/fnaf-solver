#!/usr/bin/env python3
"""Persist one external audio-authority fact stream until the caller stops it."""
import argparse
import pathlib
import socket


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--socket", required=True, help="authority Unix stream socket")
    parser.add_argument("--output", required=True, help="new JSONL output file")
    args = parser.parse_args()

    output = pathlib.Path(args.output)
    if output.exists():
        raise SystemExit("refusing to overwrite %s" % output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.connect(args.socket)
        with output.open("xb") as stream:
            while True:
                block = client.recv(4096)
                if not block:
                    break
                stream.write(block)
                stream.flush()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as error:
        raise SystemExit("collect-facts: %s" % error)
