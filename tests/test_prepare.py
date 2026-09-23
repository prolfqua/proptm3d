"""Static package preparation, ownership, and local serving."""

import gzip
import json
import threading
from urllib.request import urlopen
from zipfile import ZipFile

import cbor2
import polars as pl
import pytest

from proptm3d import cli, prepare, webapp
from proptm3d.uniprot_cache import AnnotationTables, Proteome

pytest_plugins = ["test_prepared_data"]


@pytest.fixture
def external_data(monkeypatch):
    calls = []

    def annotations(fasta_ids, accessions, cache_root):
        calls.append(("uniprot", set(accessions)))
        return AnnotationTables(
            pl.DataFrame(
                {
                    "accession": ["P12345"],
                    "taxon_id": [10090],
                    "sequence": ["ASATAYQ"],
                    "sequence_length": [7],
                }
            ),
            pl.DataFrame(
                {
                    "accession": ["P12345"],
                    "type": ["Domain"],
                    "description": ["Test domain"],
                    "start": [2],
                    "end": [5],
                    "start_modifier": ["EXACT"],
                    "end_modifier": ["EXACT"],
                    "evidence": ["[]"],
                }
            ),
            Proteome("UP000000589", 10090, "10090_MOUSE"),
            "2026_03",
            {"P12345"},
        )

    def structures(proteome, accessions, primary, cache_root):
        calls.append(("alphafold", set(accessions)))
        model_dir = cache_root / "alphafold" / "structures"
        model_dir.mkdir(parents=True, exist_ok=True)
        with gzip.open(model_dir / "AF-P12345-F1-model_v6.cif.gz", "wb") as stream:
            stream.write(b"data_P12345\n")
        return {
            "P12345": [
                {
                    "file": "AF-P12345-F1-model_v6.cif.gz",
                    "fragment": 1,
                    "version": 6,
                    "start": 1,
                    "end": 7,
                }
            ]
        }

    monkeypatch.setattr(prepare, "load_annotations", annotations)
    monkeypatch.setattr(prepare, "cache_models", structures)
    return calls


def test_prepare_all_writes_method_scoped_payloads_and_clean(
    prepared_h5mu, external_data, tmp_path
):
    root = tmp_path / "output_3d"
    cache = tmp_path / "cache"
    manifests = prepare.prepare_methods(prepared_h5mu, root, cache_root=cache)
    assert [item["method"] for item in manifests] == ["DPA", "DPU", "CF-DPU"]
    assert [call[0] for call in external_data] == ["uniprot", "alphafold"]
    assert (cache / "alphafold" / "structures" / "AF-P12345-F1-model_v6.cif.gz").is_file()
    for method in ("DPA", "DPU", "CF-DPU"):
        folder = root / method
        assert prepare.is_prepared(folder, method)
        assert (folder / "structures" / "AF-P12345-F1-model_v6.cif.gz").is_file()
        assert pl.read_parquet(folder / "tables" / "protein_features.parquet").height == 1
        with (folder / "data" / "proteins" / "P12345.cbor").open("rb") as stream:
            protein = cbor2.load(stream)
        assert len(protein["sites"]) == 3
        assert protein["protein"]["annotation_status"] == "matched"
        assert protein["structures"][0]["start"] == 1
        with (folder / "data" / "evidence" / "P12345.cbor").open("rb") as stream:
            evidence = cbor2.load(stream)
        assert len(evidence["measurements"]) == 6
    with (root / "DPU" / "data" / "site_index.cbor").open("rb") as stream:
        assert cbor2.load(stream)[0]["effect"] == 0.6
    assert pl.read_parquet(root / "DPU" / "tables" / "site_stats.parquet").height == 3
    assert prepare.clean_methods(root, ("DPA",)) == [root / "DPA"]
    assert prepare.is_prepared(root / "DPU")
    assert cache.is_dir()
    assert len(prepare.clean_methods(root)) == 2
    assert cache.is_dir()


def test_prepare_reads_statistics_member_from_delivery_zip(prepared_h5mu, external_data, tmp_path):
    archive = tmp_path / "PTM_example_statistics.zip"
    with ZipFile(archive, "w") as output:
        output.writestr("PTM_example/PTM_inputs.h5mu", b"not a statistics file")
        output.write(prepared_h5mu, "PTM_example/PTM_statistics.h5mu")
    root = tmp_path / "output_3d"

    manifests = prepare.prepare_methods(archive, root, ("DPA",), tmp_path / "cache")

    assert [item["method"] for item in manifests] == ["DPA"]
    assert prepare.is_prepared(root / "DPA", "DPA")
    assert not list(root.glob(".statistics-*"))
    assert archive.is_file()


def test_prepare_zip_requires_statistics_member(tmp_path):
    archive = tmp_path / "PTM_example_statistics.zip"
    with ZipFile(archive, "w") as output:
        output.writestr("PTM_example/PTM_inputs.h5mu", b"input only")
    with pytest.raises(ValueError, match=r"Expected exactly one PTM_statistics\.h5mu"):
        prepare.prepare_methods(archive, tmp_path / "output_3d", ("DPA",))


def test_prepare_failure_preserves_existing_package(
    prepared_h5mu, external_data, tmp_path, monkeypatch
):
    root = tmp_path / "output_3d"
    cache = tmp_path / "cache"
    prepare.prepare_methods(prepared_h5mu, root, ("DPA",), cache)
    original = (root / "DPA" / "data" / "run.json").read_bytes()
    monkeypatch.setattr(
        prepare, "cache_models", lambda *args: (_ for _ in ()).throw(RuntimeError())
    )
    with pytest.raises(RuntimeError):
        prepare.prepare_methods(prepared_h5mu, root, ("DPA",), cache)
    assert (root / "DPA" / "data" / "run.json").read_bytes() == original


def test_successful_reprepare_replaces_owned_package(prepared_h5mu, external_data, tmp_path):
    root = tmp_path / "output_3d"
    cache = tmp_path / "cache"
    prepare.prepare_methods(prepared_h5mu, root, ("DPA",), cache)
    old_file = root / "DPA" / "old-generated-file.txt"
    old_file.write_text("old")
    prepare.prepare_methods(prepared_h5mu, root, ("DPA",), cache)
    assert prepare.is_prepared(root / "DPA", "DPA")
    assert not old_file.exists()
    assert not (root / ".DPA.previous").exists()


def test_clean_refuses_unowned_directory(tmp_path):
    target = tmp_path / "DPA"
    target.mkdir()
    (target / "keep.txt").write_text("user content")
    with pytest.raises(ValueError, match="unrecognized"):
        prepare.clean_methods(tmp_path, ("DPA",))
    assert (target / "keep.txt").is_file()


def test_static_server_reads_cached_structure(prepared_h5mu, external_data, tmp_path):
    root = tmp_path / "output_3d"
    prepare.prepare_methods(prepared_h5mu, root, ("DPA",), tmp_path / "cache")
    with webapp.create_server(root / "DPA") as server:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            base = f"http://127.0.0.1:{server.server_address[1]}"
            with urlopen(base + "/data/run.json") as response:
                assert json.load(response)["method"] == "DPA"
            with urlopen(base + "/structures/AF-P12345-F1-model_v6.cif.gz") as response:
                assert gzip.decompress(response.read()) == b"data_P12345\n"
        finally:
            server.shutdown()
            worker.join()


def test_cli_serve_checks_manifest(tmp_path, monkeypatch):
    with pytest.raises(ValueError, match="No prepared DPA"):
        cli.serve("DPA", output_dir=tmp_path)
    target = tmp_path / "DPA" / "data"
    target.mkdir(parents=True)
    (target / "run.json").write_text(json.dumps({"kind": prepare.MANIFEST_KIND, "method": "DPA"}))
    calls = []
    monkeypatch.setattr(
        cli.webapp, "serve", lambda directory, port: calls.append((directory, port))
    )
    cli.serve("DPA", output_dir=tmp_path, port=3210)
    assert calls == [(tmp_path / "DPA", 3210)]


def test_cli_serve_without_method_lists_choices(capsys):
    with pytest.raises(SystemExit) as error:
        cli.serve()
    assert error.value.code == 2
    assert capsys.readouterr().err.splitlines() == [
        "Choose one method to serve: DPA, DPU, or CF-DPU.",
        "For example: proptm3d serve DPA",
    ]


def test_cli_prepare_explains_missing_default_input(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    with pytest.raises(SystemExit) as error:
        cli.prepare()
    captured = capsys.readouterr()
    assert error.value.code == 2
    assert str(tmp_path / "PTM_statistics.h5mu") in captured.err
    assert "Usage: proptm3d prepare" in captured.out
    assert "--input" in captured.out


def test_cli_prepare_prints_output_folder_and_serve_command(tmp_path, monkeypatch, capsys):
    source = tmp_path / "statistics.zip"
    source.touch()
    output = tmp_path / "prepared data"
    monkeypatch.setattr(
        cli.preparation,
        "prepare_methods",
        lambda *args: [
            {
                "method": "DPA",
                "counts": {"measured_sites": 3, "proteins": 2, "with_structures": 2},
            }
        ],
    )

    cli.prepare("DPA", input_file=source, output_dir=output)

    assert capsys.readouterr().out.splitlines() == [
        "Prepared DPA: 3 measured sites, 2 proteins, 2 structures",
        f"  Folder: {output / 'DPA'}",
        f"  Serve: proptm3d serve DPA --output-dir '{output}'",
    ]
