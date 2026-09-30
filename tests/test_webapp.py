"""Tests for the local static HTTP server."""

import json
import socket
import threading
import time
import urllib.request
from urllib.error import HTTPError, URLError

import pytest

from proptm3d import webapp


def test_server_serves_prepared_files_without_caching(tmp_path):
    (tmp_path / "index.html").write_text("<main>Prepared app</main>", encoding="utf-8")
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "run.json").write_text(json.dumps({"method": "DPA"}), encoding="utf-8")

    with webapp.create_server(tmp_path, port=0) as httpd:
        port = httpd.server_address[1]
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/index.html") as response:
                assert response.read() == b"<main>Prepared app</main>"
                assert response.headers["Cache-Control"] == "no-cache"
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/data/run.json") as response:
                assert json.loads(response.read()) == {"method": "DPA"}
                assert response.headers["Cache-Control"] == "no-cache"
        finally:
            httpd.shutdown()


def _wait_for_page(port, expected):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        try:
            address = f"http://127.0.0.1:{port}/index.html"
            with urllib.request.urlopen(address, timeout=0.2) as response:
                if response.read() == expected:
                    return
        except (OSError, URLError):
            pass
        time.sleep(0.05)
    pytest.fail(f"Port {port} did not serve {expected!r}")


def test_serve_restarts_only_authenticated_proptm3d_instance(tmp_path, monkeypatch):
    monkeypatch.setattr(webapp, "_control_path", lambda port: tmp_path / f"serve-{port}.json")
    first, second = tmp_path / "first", tmp_path / "second"
    first.mkdir()
    second.mkdir()
    (first / "index.html").write_bytes(b"first")
    (second / "index.html").write_bytes(b"second")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    failures = []

    def run(directory):
        try:
            webapp.serve(directory, port)
        except Exception as error:
            failures.append(error)

    old = threading.Thread(target=run, args=(first,), daemon=True)
    new = threading.Thread(target=run, args=(second,), daemon=True)
    old.start()
    try:
        _wait_for_page(port, b"first")
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}{webapp._RESTART_PATH}", data=b"restart", method="POST"
        )
        with pytest.raises(HTTPError) as denied:
            urllib.request.urlopen(request)
        assert denied.value.code == 403
        new.start()
        _wait_for_page(port, b"second")
    finally:
        webapp._request_restart(port)
        old.join(timeout=5)
        if new.ident is not None:
            new.join(timeout=5)
    assert not old.is_alive()
    assert not new.is_alive()
    assert failures == []


def test_serve_reports_foreign_port_without_stopping_its_server(tmp_path, monkeypatch):
    monkeypatch.setattr(webapp, "_control_path", lambda port: tmp_path / f"serve-{port}.json")
    (tmp_path / "index.html").write_bytes(b"foreign")
    with webapp.create_server(tmp_path, port=0) as httpd:
        port = httpd.server_address[1]
        worker = threading.Thread(target=httpd.serve_forever, daemon=True)
        worker.start()
        try:
            with pytest.raises(webapp.PortInUseError, match=f"Port {port} is already in use"):
                webapp.serve(tmp_path, port)
            _wait_for_page(port, b"foreign")
        finally:
            httpd.shutdown()
            worker.join(timeout=5)
