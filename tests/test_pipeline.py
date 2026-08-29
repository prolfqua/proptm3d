"""End-to-end pipeline and CLI tests with a stubbed structure fetcher."""

import json

import cbor2
import pytest

from ptm3d import cli, pipeline
from ptm3d.payload_io import JsonPayloadWriter
from ptm3d.structure_fetcher import StructureFetchError


@pytest.fixture
def input_csv(tmp_path, ptm_frame):
    path = tmp_path / "results.csv"
    ptm_frame.write_csv(path)
    return path


def test_run_pipeline_generates_all_outputs(tmp_path, input_csv, pdb_file, monkeypatch):
    monkeypatch.setattr(pipeline, "fetch_structure", lambda acc, cache_dir: pdb_file)
    out_dir = tmp_path / "output"

    index_path = pipeline.run_ptm3d_pipeline(input_csv, out_dir)

    assert index_path == out_dir / "index.html"
    assert index_path.exists()
    assert (out_dir / "app.js").exists()
    assert (out_dir / "lit.html").exists()
    # CBOR is the default payload format.
    assert (out_dir / "data" / "MAPK1_P28482.cbor").exists()
    assert (out_dir / "MAPK1_P28482_3d.html").exists()  # Standalone HTML path, on by default.
    assert (out_dir / "MAPK1_P28482_pymol.pml").exists()
    catalog = cbor2.loads((out_dir / "data" / "catalog.cbor").read_bytes())
    (entry,) = catalog["proteins"]
    assert entry["gene_name"] == "MAPK1"
    assert entry["uniprot_acc"] == "P28482"
    assert entry["sig_count"] == 2  # 2 of 3 sites have FDR <= 0.05.
    assert entry["data_file"] == "data/MAPK1_P28482.cbor"


def test_run_pipeline_with_json_writer(tmp_path, input_csv, pdb_file, monkeypatch):
    monkeypatch.setattr(pipeline, "fetch_structure", lambda acc, cache_dir: pdb_file)
    out_dir = tmp_path / "output"

    pipeline.run_ptm3d_pipeline(input_csv, out_dir, writer=JsonPayloadWriter())

    data_path = out_dir / "data" / "MAPK1_P28482.json"
    assert data_path.exists()
    payload = json.loads(data_path.read_text(encoding="utf-8"))
    assert payload["gene_name"] == "MAPK1"
    catalog = json.loads((out_dir / "data" / "catalog.json").read_text(encoding="utf-8"))
    assert catalog["proteins"][0]["data_file"] == "data/MAPK1_P28482.json"


def test_run_pipeline_without_html_reports(tmp_path, input_csv, pdb_file, monkeypatch):
    monkeypatch.setattr(pipeline, "fetch_structure", lambda acc, cache_dir: pdb_file)
    out_dir = tmp_path / "output"

    pipeline.run_ptm3d_pipeline(input_csv, out_dir, html_reports=False)

    assert (out_dir / "data" / "MAPK1_P28482.cbor").exists()
    assert not (out_dir / "MAPK1_P28482_3d.html").exists()


def test_run_pipeline_skips_unfetchable_protein(tmp_path, input_csv, monkeypatch):
    def failing_fetch(acc, cache_dir):
        raise StructureFetchError(f"no model for {acc}")

    monkeypatch.setattr(pipeline, "fetch_structure", failing_fetch)
    out_dir = tmp_path / "output"

    index_path = pipeline.run_ptm3d_pipeline(input_csv, out_dir)

    assert index_path.exists()
    catalog = cbor2.loads((out_dir / "data" / "catalog.cbor").read_bytes())
    assert catalog["proteins"] == []
    assert not (out_dir / "data" / "MAPK1_P28482.cbor").exists()


def test_run_pipeline_with_explicit_targets(tmp_path, input_csv, pdb_file, monkeypatch):
    monkeypatch.setattr(pipeline, "fetch_structure", lambda acc, cache_dir: pdb_file)
    out_dir = tmp_path / "output"

    pipeline.run_ptm3d_pipeline(input_csv, out_dir, target_proteins=["P28482", "Q00000"])

    assert (out_dir / "data" / "MAPK1_P28482.cbor").exists()
    # Q00000 has no PTM records and is skipped before fetching.
    assert not list(out_dir.glob("**/*Q00000*"))


def test_cli_main(tmp_path, input_csv, pdb_file, monkeypatch):
    monkeypatch.setattr(pipeline, "fetch_structure", lambda acc, cache_dir: pdb_file)
    out_dir = tmp_path / "cli_output"

    # Cyclopts exits with the command's return code after a successful run.
    with pytest.raises(SystemExit) as excinfo:
        cli.app(["--input", str(input_csv), "--output_dir", str(out_dir)])
    assert excinfo.value.code == 0
    assert (out_dir / "index.html").exists()
    assert (out_dir / "data" / "catalog.cbor").exists()  # The CLI defaults to --format cbor.


def test_cli_format_json(tmp_path, input_csv, pdb_file, monkeypatch):
    monkeypatch.setattr(pipeline, "fetch_structure", lambda acc, cache_dir: pdb_file)
    out_dir = tmp_path / "cli_json"

    with pytest.raises(SystemExit) as excinfo:
        cli.app(["--input", str(input_csv), "--output_dir", str(out_dir), "--format", "json"])
    assert excinfo.value.code == 0
    assert (out_dir / "data" / "catalog.json").exists()


def test_cli_requires_input(capsys):
    with pytest.raises(SystemExit) as excinfo:
        cli.app([])
    assert excinfo.value.code != 0
    output = capsys.readouterr()
    assert "--input" in output.out + output.err
