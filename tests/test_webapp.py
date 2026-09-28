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
