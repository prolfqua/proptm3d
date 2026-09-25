"""Tests for the local static HTTP server."""

import json
import threading
import urllib.request

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


def test_server_serves_virtual_method_chooser_without_writing_to_root(tmp_path):
    for method in ("DPA", "DPU", "CF-DPU"):
        folder = tmp_path / method
        folder.mkdir()
        (folder / "index.html").write_text(f"<main>{method}</main>", encoding="utf-8")
    landing_page = '<a href="DPA/index.html">DPA</a>'

    with webapp.create_server(tmp_path, port=0, landing_page=landing_page) as httpd:
        port = httpd.server_address[1]
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            for path in ("/", "/index.html"):
                with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}") as response:
                    assert response.read() == landing_page.encode()
                    assert response.headers["Content-Type"] == "text/html; charset=utf-8"
                    assert response.headers["Cache-Control"] == "no-cache"
            request = urllib.request.Request(f"http://127.0.0.1:{port}/", method="HEAD")
            with urllib.request.urlopen(request) as response:
                assert response.status == 200
                assert response.headers["Content-Length"] == str(len(landing_page))
                assert response.read() == b""
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/DPU/index.html") as response:
                assert response.read() == b"<main>DPU</main>"
        finally:
            httpd.shutdown()
            thread.join()
    assert not (tmp_path / "index.html").exists()
