"""Tests for the browser app assets, catalog, and local HTTP server."""

import json
import threading
import urllib.request

import cbor2

from proptm3d import webapp
from proptm3d.payload_io import CborPayloadWriter, JsonPayloadWriter

CONTRAST_STATS = {
    "A_vs_B": {"sig_count": 1, "max_log2fc": -2.0},
    "C_vs_B": {"sig_count": 1, "max_log2fc": 0.3},
}

REPORT = webapp.ProteinReport(
    gene_name="MAPK1",
    uniprot_acc="P28482",
    ptm_count=3,
    sig_count=2,
    max_log2fc=-2.0,
    contrast_stats=CONTRAST_STATS,
    data_file="data/MAPK1_P28482.cbor",
    pml_file="MAPK1_P28482_pymol.pml",
)

REPORT_DICT = {
    "gene_name": "MAPK1",
    "uniprot_acc": "P28482",
    "ptm_count": 3,
    "sig_count": 2,
    "max_log2fc": -2.0,
    "contrast_stats": CONTRAST_STATS,
    "data_file": "data/MAPK1_P28482.cbor",
    "pml_file": "MAPK1_P28482_pymol.pml",
}


def test_write_catalog_json(tmp_path):
    path = webapp.write_catalog(tmp_path, [REPORT], JsonPayloadWriter(), 0.05)

    assert path == tmp_path / "data" / "catalog.json"
    assert json.loads(path.read_text(encoding="utf-8")) == {
        "proteins": [REPORT_DICT],
        "fdr_threshold": 0.05,
    }


def test_write_catalog_cbor(tmp_path):
    path = webapp.write_catalog(tmp_path, [REPORT], CborPayloadWriter(), 0.25)

    assert path == tmp_path / "data" / "catalog.cbor"
    assert cbor2.loads(path.read_bytes()) == {"proteins": [REPORT_DICT], "fdr_threshold": 0.25}


def test_install_app(tmp_path):
    webapp.install_app(tmp_path)

    index_html = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert '<script type="module" src="app.js"></script>' in index_html
    lit_html = (tmp_path / "lit.html").read_text(encoding="utf-8")
    assert "<ptm-app></ptm-app>" in lit_html
    payload_js = (tmp_path / "payload.js").read_text(encoding="utf-8")
    assert "catalog.cbor" in payload_js
    assert (tmp_path / "lit-app.js").exists()
    assert (tmp_path / "color.js").exists()
    assert (tmp_path / "viewer3d.js").exists()
    assert (tmp_path / "vendor" / "lit.js").exists()
    assert (tmp_path / "vendor" / "cbor.js").exists()
    assert (tmp_path / "vendor" / "tabulator.js").exists()
    assert (tmp_path / "vendor" / "plotly.js").exists()
    assert (tmp_path / "panels" / "ntoc.js").exists()
    assert (tmp_path / "render" / "plotly.js").exists()


def test_server_serves_catalog_and_apps(tmp_path):
    webapp.install_app(tmp_path)
    webapp.write_catalog(tmp_path, [REPORT], CborPayloadWriter(), 0.05)

    with webapp.create_server(tmp_path, port=0) as httpd:
        port = httpd.server_address[1]
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/data/catalog.cbor") as response:
                payload = cbor2.loads(response.read())
                assert response.headers["Cache-Control"] == "no-cache"
            assert payload["proteins"][0]["gene_name"] == "MAPK1"
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/index.html") as response:
                assert b"3D PTM" in response.read()
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/lit.html") as response:
                assert b"ptm-app" in response.read()
        finally:
            httpd.shutdown()
