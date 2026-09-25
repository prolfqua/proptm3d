"""Serve prepared browser files through a local HTTP server."""

from __future__ import annotations

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from socket import socket
from typing import IO
from urllib.parse import urlsplit

from loguru import logger


class _NoCacheHandler(SimpleHTTPRequestHandler):
    """Static file handler that forbids caching, so app updates reach the browser."""

    def __init__(
        self,
        request: socket,
        client_address: tuple[str, int],
        server: ThreadingHTTPServer,
        *,
        directory: str,
        landing_page: bytes | None = None,
    ) -> None:
        self._landing_page = landing_page
        super().__init__(request, client_address, server, directory=directory)

    def send_head(self) -> IO[bytes] | None:
        """Serve a virtual root index when a prepared root has no index file."""
        if self._landing_page is not None and urlsplit(self.path).path in {"/", "/index.html"}:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(self._landing_page)))
            self.end_headers()
            return BytesIO(self._landing_page)
        return super().send_head()

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def create_server(
    directory: Path | str, port: int = 0, *, landing_page: str | None = None
) -> ThreadingHTTPServer:
    """Create an HTTP server rooted at a generated output directory.

    Responses carry ``Cache-Control: no-cache`` so browsers revalidate the app's
    module files on every load instead of serving stale cached copies.

    Args:
        directory: Directory to serve.
        port: TCP port; 0 picks a free one.
        landing_page: Optional HTML served at the root instead of a directory listing.

    Returns:
        The configured (not yet running) server.
    """
    handler = partial(
        _NoCacheHandler,
        directory=str(directory),
        landing_page=landing_page.encode("utf-8") if landing_page is not None else None,
    )
    return ThreadingHTTPServer(("127.0.0.1", port), handler)


def serve(directory: Path | str, port: int = 8000, *, landing_page: str | None = None) -> None:
    """Serve a generated output directory and block until interrupted.

    Args:
        directory: Directory to serve (a proptm3d output folder).
        port: TCP port to listen on.
        landing_page: Optional HTML served at the root.
    """
    with create_server(directory, port, landing_page=landing_page) as httpd:
        host, actual_port = httpd.server_address[0], httpd.server_address[1]
        logger.info("Serving {} at http://{}:{}/ (Ctrl+C to stop)", directory, host, actual_port)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            logger.info("Server stopped")
