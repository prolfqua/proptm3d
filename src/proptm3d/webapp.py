"""Serve prepared browser files through a local HTTP server."""

from __future__ import annotations

import errno
import json
import os
import secrets
import tempfile
import threading
import time
from functools import partial
from http.client import HTTPConnection, HTTPException
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from loguru import logger
from platformdirs import user_data_path

_RESTART_PATH = "/__proptm3d/restart"
_TOKEN_HEADER = "X-Proptm3d-Token"


class PortInUseError(RuntimeError):
    """A port is occupied by a server that cannot be safely replaced."""


class _NoCacheHandler(SimpleHTTPRequestHandler):
    """Static file handler that forbids caching, so app updates reach the browser."""

    def do_POST(self) -> None:
        """Let another proptm3d invocation stop this instance with its private token."""
        server = self.server
        if self.path != _RESTART_PATH or not isinstance(server, _PreparedServer):
            self.send_error(404)
            return
        if server.control_token is None or self.headers.get(_TOKEN_HEADER) != server.control_token:
            self.send_error(403)
            return
        self.send_response(202)
        self.end_headers()
        self.wfile.write(b"Restarting proptm3d server\n")
        self.wfile.flush()
        threading.Thread(target=server.shutdown, daemon=True).start()

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


class _PreparedServer(ThreadingHTTPServer):
    """Static server with an optional authenticated local restart endpoint."""

    control_token: str | None = None


def create_server(
    directory: Path | str, port: int = 0, *, control_token: str | None = None
) -> ThreadingHTTPServer:
    """Create an HTTP server rooted at a static output directory.

    Responses carry ``Cache-Control: no-cache`` so browsers revalidate the app's
    module files on every load instead of serving stale cached copies.

    Args:
        directory: Directory to serve.
        port: TCP port; 0 picks a free one.
        control_token: Private token enabling the local restart endpoint, or None to disable it.

    Returns:
        The configured (not yet running) server.
    """
    handler = partial(_NoCacheHandler, directory=str(directory))
    server = _PreparedServer(("127.0.0.1", port), handler)
    server.control_token = control_token
    return server


def _control_path(port: int) -> Path:
    return user_data_path("proptm3d") / f"serve-{port}.json"


def _register(port: int, token: str) -> None:
    path = _control_path(port)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".serve-{port}-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump({"token": token}, stream)
        Path(temporary).replace(path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def _unregister(port: int, token: str) -> None:
    path = _control_path(port)
    try:
        if json.loads(path.read_text())["token"] == token:
            path.unlink()
    except FileNotFoundError:
        pass


def _request_restart(port: int) -> bool:
    try:
        token = json.loads(_control_path(port).read_text())["token"]
        connection = HTTPConnection("127.0.0.1", port, timeout=2)
        try:
            connection.request(
                "POST", _RESTART_PATH, body=b"restart", headers={_TOKEN_HEADER: token}
            )
            return connection.getresponse().status == 202
        finally:
            connection.close()
    except (OSError, ValueError, KeyError, HTTPException):
        return False


def _bind_server(directory: Path | str, port: int, token: str) -> ThreadingHTTPServer:
    try:
        return create_server(directory, port, control_token=token)
    except OSError as error:
        if error.errno != errno.EADDRINUSE:
            raise
    if not _request_restart(port):
        msg = (
            f"Port {port} is already in use and is not a restartable proptm3d server. "
            f"Stop that server, or choose a free port with --port 8001."
        )
        raise PortInUseError(msg) from None
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        try:
            return create_server(directory, port, control_token=token)
        except OSError as error:
            if error.errno != errno.EADDRINUSE:
                raise
            time.sleep(0.05)
    msg = f"The previous proptm3d server did not release port {port}; stop it or use --port 8001."
    raise PortInUseError(msg)


def serve(directory: Path | str, port: int = 8000) -> None:
    """Serve a static output directory, replacing a verified local instance if necessary.

    Args:
        directory: Directory to serve (a proptm3d output folder).
        port: TCP port to listen on.
    """
    token = secrets.token_urlsafe(32)
    with _bind_server(directory, port, token) as httpd:
        host, actual_port = httpd.server_address[0], httpd.server_address[1]
        _register(actual_port, token)
        try:
            logger.info(
                "Serving {} at http://{}:{}/ (Ctrl+C to stop)", directory, host, actual_port
            )
            httpd.serve_forever()
        except KeyboardInterrupt:
            logger.info("Server stopped")
        finally:
            _unregister(actual_port, token)
