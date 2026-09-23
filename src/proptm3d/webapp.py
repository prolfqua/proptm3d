"""Serve prepared browser files through a local HTTP server."""

from __future__ import annotations

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from loguru import logger


class _NoCacheHandler(SimpleHTTPRequestHandler):
    """Static file handler that forbids caching, so app updates reach the browser."""

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def create_server(directory: Path | str, port: int = 0) -> ThreadingHTTPServer:
    """Create an HTTP server rooted at a generated output directory.

    Responses carry ``Cache-Control: no-cache`` so browsers revalidate the app's
    module files on every load instead of serving stale cached copies.

    Args:
        directory: Directory to serve.
        port: TCP port; 0 picks a free one.

    Returns:
        The configured (not yet running) server.
    """
    handler = partial(_NoCacheHandler, directory=str(directory))
    return ThreadingHTTPServer(("127.0.0.1", port), handler)


def serve(directory: Path | str, port: int = 8000) -> None:
    """Serve a generated output directory and block until interrupted.

    Args:
        directory: Directory to serve (a proptm3d output folder).
        port: TCP port to listen on.
    """
    with create_server(directory, port) as httpd:
        host, actual_port = httpd.server_address[0], httpd.server_address[1]
        logger.info("Serving {} at http://{}:{}/ (Ctrl+C to stop)", directory, host, actual_port)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            logger.info("Server stopped")
