"""Serve an extracted proptm3d bundle with Python's standard library."""

from __future__ import annotations

import argparse
from contextlib import suppress
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class _NoCacheHandler(SimpleHTTPRequestHandler):
    """Revalidate browser assets after a bundle is replaced."""

    def end_headers(self) -> None:
        """Add a no-cache response header."""
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def create_server(port: int = 8000) -> ThreadingHTTPServer:
    """Serve the extracted bundle's directory on localhost."""
    root = Path(__file__).resolve().parent
    handler = partial(_NoCacheHandler, directory=str(root))
    return ThreadingHTTPServer(("127.0.0.1", port), handler)


def main() -> None:
    """Run the local server until interrupted."""
    parser = argparse.ArgumentParser(description="Serve this extracted proptm3d bundle locally")
    parser.add_argument("--port", type=int, default=8000, help="local port (default: 8000)")
    args = parser.parse_args()
    with create_server(args.port) as server:
        port = server.server_address[1]
        print(f"Open http://127.0.0.1:{port}/ (Ctrl+C to stop)", flush=True)
        with suppress(KeyboardInterrupt):
            server.serve_forever()


if __name__ == "__main__":
    main()
