"""Static package preparation, ownership, and local serving."""

import gzip
import hashlib
import json
import shutil
import threading
from urllib.request import urlopen
from zipfile import ZipFile

import cbor2
import h5py
import polars as pl
import pytest

from proptm3d import bundle, cli, prepare, prepared_root, webapp
from proptm3d.uniprot_cache import AnnotationTables, Proteome

pytest_plugins = ["test_prepared_data"]


@pytest.fixture(autouse=True)
def isolated_prepared_history(tmp_path, monkeypatch):
    monkeypatch.setattr(cli.prepared_history, "history_path", lambda: tmp_path / "history.json")


def _gsea_artifact(analysis="DPA"):
    document = json.dumps(
        {
            "data": {
                "a_vs_b": {
                    "categories": {
                        "PTM-SEA": {
                            "terms": [
                                {
                                    "term_id": "KINASE_X",
                                    "description": "Kinase X",
                                    "enrichment_score": 1.5,
                                    "direction": "top",
                                    "fdr": 0.01,
                                    "method": "fgsea",
                                    "genes_mapped": 2,
                                    "genes_in_set": 3,
                                    "gene_ids": ["ASAA", "AATA"],
                                    "leading_edge_ids": ["ASAA"],
                                }
                            ]
                        }
                    }
                }
            }
        },
        separators=(",", ":"),
    )
    wrapper = {
        "format": "prophosqua_stage",
        "version": "1.0.0",
        "stage": "PTMSEA",
        "analysis": analysis,
        "statistics_sha256": "statistics-digest",
        "document": {
            "format": "string_gsea",
            "version": "1.2.0",
            "json": document,
            "sha256": hashlib.sha256(document.encode()).hexdigest(),
        },
    }
    return gzip.compress(cbor2.dumps(wrapper))


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
        pae_dir = cache_root / "alphafold" / "pae"
        pae_dir.mkdir(parents=True, exist_ok=True)
        with gzip.open(pae_dir / "AF-P12345-F1-predicted_aligned_error_v6.json.gz", "wt") as pae:
            json.dump(
                [
                    {
                        "predicted_aligned_error": [[0, 3], [4, 0]],
                        "max_predicted_aligned_error": 31.75,
                    }
                ],
                pae,
            )
        return {
            "P12345": [
                {
                    "file": "AF-P12345-F1-model_v6.cif.gz",
                    "model_id": "AF-P12345-F1",
                    "fragment": 1,
                    "version": 6,
                    "start": 1,
                    "end": 7,
                }
            ]
        }

    def contexts(proteome, models, cache_root):
        calls.append(("context-cache", set(models)))
        return {}

    monkeypatch.setattr(prepare, "load_annotations", annotations)
    monkeypatch.setattr(prepare, "cache_models", structures)
    monkeypatch.setattr(prepare, "load_precomputed_contexts", contexts)
    return calls


def test_prepare_all_writes_method_scoped_payloads_and_clean(
    prepared_h5mu, external_data, tmp_path
):
    root = tmp_path / "output_3d"
    cache = tmp_path / "cache"
    manifests = prepare.prepare_stats(prepared_h5mu, root, cache_root=cache)
    assert [item["method"] for item in manifests] == ["DPA", "DPU", "CF-DPU"]
    assert [call[0] for call in external_data] == ["uniprot", "alphafold", "context-cache"]
    assert (cache / "alphafold" / "structures" / "AF-P12345-F1-model_v6.cif.gz").is_file()
    for method in ("DPA", "DPU", "CF-DPU"):
        folder = root / method
        assert prepare.is_prepared(folder, method)
        assert "<ptm-browser-app>" in (folder / "index.html").read_text()
        inventory = json.loads((folder / "data" / "browser-assets.json").read_text())
        assert inventory["files"]
        assert all((folder / path).is_file() for path in inventory["files"])
        backgrounds = json.loads((folder / "data" / "plot_backgrounds.json").read_text())
        assert backgrounds["plots"]
        assert (folder / backgrounds["plots"]["a_vs_b"]["volcano"]["file"]).is_file()
        assert (folder / "structures" / "AF-P12345-F1-model_v6.cif.gz").is_file()
        manifest = json.loads((folder / "data" / "run.json").read_text())
        assert manifest["schema_version"] == "2"
        assert manifest["files"] == {
            "proteins_parquet": "tables/proteins.parquet",
            "sites_parquet": "tables/sites.parquet",
            "site_stats_parquet": "tables/site_stats.parquet",
            "measurements_parquet": "tables/measurements.parquet",
            "protein_features_parquet": "tables/protein_features.parquet",
            "structures_parquet": "tables/structures.parquet",
            "site_structural_context_parquet": "tables/site_structural_context.parquet",
        }
        assert not list(folder.rglob("*.cbor"))
        assert pl.read_parquet(folder / "tables" / "sites.parquet").height == 3
        assert pl.read_parquet(folder / "tables" / "protein_features.parquet").height == 1
        assert pl.read_parquet(folder / "tables" / "measurements.parquet").height == 6
        assert (
            pl.read_parquet(folder / "tables" / "site_structural_context.parquet")[
                "mapping_status"
            ].to_list()
            == ["unavailable"] * 3
        )
        protein = pl.read_parquet(folder / "tables" / "proteins.parquet").row(0, named=True)
        assert protein["annotation_status"] == "matched"
        description = (
            "CF protein OS=Mus musculus OX=10090"
            if method == "CF-DPU"
            else "Example protein OS=Mus musculus OX=10090"
        )
        assert protein["description"] == description
        assert protein["uniprot_url"] == "https://www.uniprot.org/uniprotkb/P12345"
        assert protein["string_url"] == (
            "https://string-db.org/cgi/network?identifiers=P12345&species=10090"
        )
        structure = pl.read_parquet(folder / "tables" / "structures.parquet").row(0, named=True)
        assert structure == {
            "protein_Id": protein["protein_Id"],
            "accession": "P12345",
            "file": "AF-P12345-F1-model_v6.cif.gz",
            "fragment": 1,
            "version": 6,
            "start": 1,
            "end": 7,
            "url": "structures/AF-P12345-F1-model_v6.cif.gz",
            "pae_url": "pae/AF-P12345-F1-predicted_aligned_error_v6.json.gz",
            "context_url": None,
        }
        pae_link = folder / "pae" / "AF-P12345-F1-predicted_aligned_error_v6.json.gz"
        assert pae_link.is_symlink()
        assert (
            pae_link.resolve()
            == (
                cache / "alphafold" / "pae" / "AF-P12345-F1-predicted_aligned_error_v6.json.gz"
            ).resolve()
        )
        assert [path.name for path in (folder / "pae").iterdir()] == [pae_link.name]
    stats = pl.read_parquet(root / "DPU" / "tables" / "site_stats.parquet")
    assert stats.height == 3
    assert stats["effect"][0] == 0.6
    assert prepared_root.available_methods(root) == ("DPA", "DPU", "CF-DPU")
    assert prepared_root.clean_prepared_root(root) == root.resolve()
    assert not root.exists()
    assert cache.is_dir()


def test_prepare_then_bundle_needs_no_browser_deploy(prepared_h5mu, external_data, tmp_path):
    root = tmp_path / "viewer"
    prepare.prepare_stats(prepared_h5mu, root, ("DPA",), tmp_path / "cache")

    archive_path = bundle.bundle_prepared_root(root, "DPA")

    with ZipFile(archive_path) as archive:
        names = set(archive.namelist())
        assert "index.html" in names
        assert "data/plot_backgrounds/volcano-0.png" in names
        asset_inventory = json.loads(archive.read("data/browser-assets.json"))
        assert set(asset_inventory["files"]).issubset(names)
        assert "<ptm-browser-app>" in archive.read("index.html").decode()

    with (
        bundle.extracted_bundle(archive_path) as extracted,
        webapp.create_server(extracted) as server,
    ):
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            base = f"http://127.0.0.1:{server.server_address[1]}"
            with urlopen(f"{base}/index.html") as response:
                assert b"<ptm-browser-app>" in response.read()
            with urlopen(f"{base}/{asset_inventory['files'][0]}") as response:
                assert response.read()
            with urlopen(f"{base}/data/plot_backgrounds/volcano-0.png") as response:
                assert response.read().startswith(b"\x89PNG")
            with urlopen(f"{base}/tables/site_stats.parquet") as response:
                assert pl.read_parquet(response.read()).height > 0
        finally:
            server.shutdown()
            worker.join()


def test_dpu_counts_complete_results_without_dropping_measured_sites(
    prepared_h5mu, external_data, tmp_path
):
    with h5py.File(prepared_h5mu, "r+") as handle:
        handle["mod/enriched/X"][:, 2] = [5.0, 6.0]
    root = tmp_path / "output_3d"

    [manifest] = prepare.prepare_stats(prepared_h5mu, root, ("DPU",), tmp_path / "cache")

    assert manifest["counts"]["measured_sites"] == 3
    assert manifest["counts"]["complete_result_sites"] == 2
    assert manifest["counts"]["complete_result_proteins"] == 1
    assert manifest["counts"]["complete_result_structures"] == 1
    assert manifest["counts"]["measured_sites_without_result"] == 1
    assert pl.read_parquet(root / "DPU" / "tables" / "sites.parquet").height == 3


def test_prepare_writes_typed_empty_structures_parquet(
    prepared_h5mu, external_data, tmp_path, monkeypatch
):
    monkeypatch.setattr(prepare, "cache_models", lambda *args: {})
    root = tmp_path / "output_3d"

    [manifest] = prepare.prepare_stats(prepared_h5mu, root, ("DPA",), tmp_path / "cache")

    structures = pl.read_parquet(root / "DPA" / "tables" / "structures.parquet")
    assert structures.is_empty()
    assert structures.schema == {
        "protein_Id": pl.String,
        "accession": pl.String,
        "file": pl.String,
        "fragment": pl.Int64,
        "version": pl.Int64,
        "start": pl.Int64,
        "end": pl.Int64,
        "url": pl.String,
        "pae_url": pl.String,
        "context_url": pl.String,
    }
    assert manifest["counts"]["with_structures"] == 0
    assert manifest["counts"]["complete_result_structures"] == 0
    assert list((root / "DPA" / "pae").iterdir()) == []


def test_prepare_leaves_pae_url_null_without_a_cached_matrix(
    prepared_h5mu, external_data, tmp_path
):
    cache = tmp_path / "cache"
    root = tmp_path / "output_3d"

    def remove_pae(*args, **kwargs):
        models = cache_models(*args, **kwargs)
        (cache / "alphafold" / "pae" / "AF-P12345-F1-predicted_aligned_error_v6.json.gz").unlink()
        return models

    cache_models = prepare.cache_models
    prepare.cache_models = remove_pae
    try:
        prepare.prepare_stats(prepared_h5mu, root, ("DPA",), cache)
    finally:
        prepare.cache_models = cache_models

    structure = pl.read_parquet(root / "DPA" / "tables" / "structures.parquet").row(0, named=True)
    assert structure["pae_url"] is None
    assert list((root / "DPA" / "pae").iterdir()) == []


def test_prepare_structural_context_exports_site_annotations(
    prepared_h5mu, external_data, tmp_path, monkeypatch
):
    cache = tmp_path / "cache"
    context_path = (
        cache / "alphafold" / "structural_context" / "bludau-v1" / "AF-P12345-F1-model_v6.parquet"
    )
    context_path.parent.mkdir(parents=True)

    def precomputed_contexts(proteome, models, cache_root):
        external_data.append(("context-cache", set(models)))
        pl.DataFrame(
            {
                "accession": ["P12345", "P12345"],
                "model_id": ["AF-P12345-F1", "AF-P12345-F1"],
                "fragment": [1, 1],
                "version": [6, 6],
                "model_position": [2, 4],
                "position": [2, 4],
                "residue": ["S", "T"],
                "plddt": [91.0, 82.0],
                "nAA_12_70_pae": [3, 7],
                "is_exposed": [True, False],
                "nAA_24_180_pae": [12, 44],
                "nAA_24_180_pae_smooth10": [20.0, 40.0],
                "is_idr": [True, False],
            }
        ).write_parquet(context_path)
        return {"AF-P12345-F1-model_v6.cif.gz": context_path}

    monkeypatch.setattr(prepare, "load_precomputed_contexts", precomputed_contexts)
    root = tmp_path / "output_3d"

    [manifest] = prepare.prepare_stats(prepared_h5mu, root, ("DPA",), cache)

    context = pl.read_parquet(root / "DPA" / "tables" / "site_structural_context.parquet")
    assert context["mapping_status"].to_list() == ["matched", "matched", "unavailable"]
    assert manifest["structural_context"]["algorithm_version"] == "bludau-v1"
    assert manifest["counts"]["structural_context_models"] == 1
    structure = pl.read_parquet(root / "DPA" / "tables" / "structures.parquet").row(0, named=True)
    assert structure["context_url"] == "residue_context/AF-P12345-F1-model_v6.parquet"
    assert (root / "DPA" / structure["context_url"]).resolve() == context_path.resolve()
    assert manifest["counts"]["structural_context_matched_sites"] == 2
    assert manifest["files"]["site_structural_context_parquet"] == (
        "tables/site_structural_context.parquet"
    )
    assert not list((root / "DPA").rglob("*.cbor"))
    assert [call[0] for call in external_data] == ["uniprot", "alphafold", "context-cache"]


def test_prepare_reads_statistics_member_from_delivery_zip(prepared_h5mu, external_data, tmp_path):
    archive = tmp_path / "PTM_example_statistics.zip"
    with ZipFile(archive, "w") as output:
        output.writestr("PTM_example/PTM_inputs.h5mu", b"not a statistics file")
        output.write(prepared_h5mu, "PTM_example/PTM_statistics.h5mu")
    root = tmp_path / "output_3d"

    manifests = prepare.prepare_stats(archive, root, ("DPA",), tmp_path / "cache")

    assert [item["method"] for item in manifests] == ["DPA"]
    assert prepare.is_prepared(root / "DPA", "DPA")
    assert not list(root.glob(".statistics-*"))
    assert archive.is_file()


def test_prepare_zip_requires_statistics_member(tmp_path):
    archive = tmp_path / "PTM_example_statistics.zip"
    with ZipFile(archive, "w") as output:
        output.writestr("PTM_example/PTM_inputs.h5mu", b"input only")
    with pytest.raises(ValueError, match=r"Expected exactly one PTM_statistics\.h5mu"):
        prepare.prepare_stats(archive, tmp_path / "output_3d", ("DPA",))


def test_prepare_gsea_writes_stats_and_gsea_parquet(prepared_h5mu, external_data, tmp_path):
    results = tmp_path / "PTM_results.h5mu"
    shutil.copyfile(prepared_h5mu, results)
    with h5py.File(results, "r+") as handle:
        handle["uns/prophosqua/stage"][...] = "PTM_results"
    archive = tmp_path / "PTM_complete.zip"
    with ZipFile(archive, "w") as output:
        output.write(results, "PTM_example/PTM_results.h5mu")
        output.writestr(
            "PTM_example/PTM_DPA/result_ptm_sea.cbor.gz",
            _gsea_artifact(),
        )

    [manifest] = prepare.prepare_gsea(archive, tmp_path / "output_3d", ("DPA",), tmp_path / "cache")

    folder = tmp_path / "output_3d" / "DPA"
    assert manifest["preparation"] == "gsea"
    assert manifest["counts"]["gsea_terms"] == 1
    assert manifest["counts"]["gsea_sources"] == 1
    assert manifest["files"]["gsea_terms_parquet"] == "tables/gsea_terms.parquet"
    terms = pl.read_parquet(folder / "tables" / "gsea_terms.parquet")
    assert terms.select("term_id", "source", "gene_ids").to_dicts() == [
        {
            "term_id": "KINASE_X",
            "source": "PTM-SEA",
            "gene_ids": ["ASAA", "AATA"],
        }
    ]
    assert (folder / "tables" / "measurements.parquet").is_file()
    assert (folder / "tables" / "site_stats.parquet").is_file()
    assert not list((folder).rglob("*.cbor"))


def test_prepare_gsea_requires_results_in_completed_delivery(prepared_h5mu, tmp_path):
    results = tmp_path / "PTM_results.h5mu"
    shutil.copyfile(prepared_h5mu, results)
    with h5py.File(results, "r+") as handle:
        handle["uns/prophosqua/stage"][...] = "PTM_results"
    archive = tmp_path / "PTM_without_gsea.zip"
    with ZipFile(archive, "w") as output:
        output.write(results, "PTM_example/PTM_results.h5mu")

    with pytest.raises(ValueError, match="no GSEA results for: DPA"):
        prepare.prepare_gsea(archive, tmp_path / "output_3d", ("DPA",))
    with pytest.raises(ValueError, match="requires a completed PTM delivery ZIP"):
        prepare.prepare_gsea(results, tmp_path / "output_3d", ("DPA",))

    archive_without_results = tmp_path / "not_completed.zip"
    with ZipFile(archive_without_results, "w") as output:
        output.writestr("PTM_example/readme.txt", "not complete")
    with pytest.raises(ValueError, match=r"Expected exactly one PTM_results\.h5mu"):
        prepare.prepare_gsea(archive_without_results, tmp_path / "output_3d", ("DPA",))


def test_prepare_entry_points_require_existing_inputs(tmp_path):
    missing = tmp_path / "missing.zip"
    with pytest.raises(FileNotFoundError):
        prepare.prepare_stats(missing, tmp_path / "viewer")
    with pytest.raises(FileNotFoundError):
        prepare.prepare_gsea(missing, tmp_path / "viewer")


def test_prepare_failure_preserves_existing_package(
    prepared_h5mu, external_data, tmp_path, monkeypatch
):
    root = tmp_path / "output_3d"
    cache = tmp_path / "cache"
    prepare.prepare_stats(prepared_h5mu, root, ("DPA",), cache)
    original = (root / "DPA" / "data" / "run.json").read_bytes()
    monkeypatch.setattr(
        prepare, "cache_models", lambda *args: (_ for _ in ()).throw(RuntimeError())
    )
    with pytest.raises(RuntimeError):
        prepare.prepare_stats(prepared_h5mu, root, ("DPA",), cache)
    assert (root / "DPA" / "data" / "run.json").read_bytes() == original


def test_successful_reprepare_replaces_owned_package(prepared_h5mu, external_data, tmp_path):
    root = tmp_path / "output_3d"
    cache = tmp_path / "cache"
    prepare.prepare_stats(prepared_h5mu, root, ("DPA",), cache)
    (root / "DPA" / "index.html").write_text("old generated placeholder")
    prepare.prepare_stats(prepared_h5mu, root, ("DPA",), cache)
    assert prepare.is_prepared(root / "DPA", "DPA")
    assert "old generated placeholder" not in (root / "DPA" / "index.html").read_text()
    assert not (root / ".DPA.previous").exists()


def test_reprepare_preserves_unrecognized_method_file(prepared_h5mu, external_data, tmp_path):
    root = tmp_path / "viewer"
    cache = tmp_path / "cache"
    prepare.prepare_stats(prepared_h5mu, root, ("DPA",), cache)
    note = root / "DPA" / "notes.txt"
    note.write_text("user note")

    with pytest.raises(ValueError, match="unrecognized"):
        prepare.prepare_stats(prepared_h5mu, root, ("DPA",), cache)

    assert note.read_text() == "user note"
    assert prepare.is_prepared(root / "DPA", "DPA")
    assert not (root / ".DPA.previous").exists()


def test_reprepare_preserves_stale_backup(prepared_h5mu, external_data, tmp_path):
    root = tmp_path / "viewer"
    cache = tmp_path / "cache"
    prepare.prepare_stats(prepared_h5mu, root, ("DPA",), cache)
    backup = root / ".DPA.previous"
    backup.mkdir()
    (backup / "notes.txt").write_text("recover me")

    with pytest.raises(FileExistsError, match="previous"):
        prepare.prepare_stats(prepared_h5mu, root, ("DPA",), cache)

    assert (backup / "notes.txt").read_text() == "recover me"
    assert prepare.is_prepared(root / "DPA", "DPA")


def test_failed_publish_restores_previous_method(
    prepared_h5mu, external_data, tmp_path, monkeypatch
):
    root = tmp_path / "viewer"
    prepare.prepare_stats(prepared_h5mu, root, ("DPA",), tmp_path / "cache")
    target = root / "DPA"
    original_manifest = (target / "data" / "run.json").read_bytes()
    staging = root / "staging"
    shutil.copytree(target, staging, symlinks=True)
    original_replace = type(staging).replace

    def fail_publish(self, destination):
        if self == staging:
            raise OSError("publish failed")
        return original_replace(self, destination)

    monkeypatch.setattr(type(staging), "replace", fail_publish)
    with pytest.raises(OSError, match="publish failed"):
        prepare._replace_directory(staging, target)

    assert (target / "data" / "run.json").read_bytes() == original_manifest
    assert not (root / ".DPA.previous").exists()


def test_clean_refuses_unowned_directory(tmp_path):
    target = tmp_path / "DPA"
    target.mkdir()
    (target / "keep.txt").write_text("user content")
    with pytest.raises(ValueError, match="unrecognized"):
        prepared_root.clean_prepared_root(tmp_path)
    assert (target / "keep.txt").is_file()


def test_static_server_reads_cached_structure(prepared_h5mu, external_data, tmp_path):
    root = tmp_path / "output_3d"
    prepare.prepare_stats(prepared_h5mu, root, ("DPA",), tmp_path / "cache")
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
        cli.serve("DPA", tmp_path)
    target = tmp_path / "DPA" / "data"
    target.mkdir(parents=True)
    (target / "run.json").write_text(json.dumps({"kind": prepare.MANIFEST_KIND, "method": "DPA"}))
    calls = []
    monkeypatch.setattr(
        cli.webapp, "serve", lambda directory, port: calls.append((directory, port))
    )
    cli.serve("DPA", tmp_path, port=3210)
    assert calls == [(tmp_path / "DPA", 3210)]
    assert cli.prepared_history.prepared_folders() == (tmp_path.resolve(),)


def test_cli_serve_refuses_symlinked_method(tmp_path, monkeypatch):
    source = tmp_path / "source"
    method = source / "DPA" / "data"
    method.mkdir(parents=True)
    (method / "run.json").write_text(json.dumps({"kind": prepare.MANIFEST_KIND, "method": "DPA"}))
    alias = tmp_path / "alias"
    alias.mkdir()
    (alias / "DPA").symlink_to(source / "DPA", target_is_directory=True)
    monkeypatch.setattr(cli.webapp, "serve", lambda *args, **kwargs: pytest.fail("served alias"))

    with pytest.raises(ValueError, match="symlink"):
        cli.serve("DPA", alias)


def test_cli_serve_requires_method_and_folder(capsys):
    with pytest.raises(SystemExit) as error:
        cli.app(["serve"])
    assert error.value.code != 0
    assert "--target" in capsys.readouterr().err


def test_serve_rejects_unprepared_path_without_folder(tmp_path):
    with pytest.raises(ValueError, match="Pass a prepared FOLDER, METHOD FOLDER"):
        cli.serve("DPA")
    with pytest.raises(ValueError, match="Unknown method"):
        cli.serve("unknown", tmp_path)


def test_cli_prepare_requires_explicit_input(tmp_path, capsys):
    with pytest.raises(SystemExit) as error:
        cli.app(["prepare", "stats", str(tmp_path / "viewer")])
    captured = capsys.readouterr()
    assert error.value.code != 0
    assert "--input" in captured.err + captured.out


def test_cli_prepare_prints_output_folder_and_serve_command(tmp_path, monkeypatch, capsys):
    source = tmp_path / "statistics.zip"
    source.touch()
    output = tmp_path / "prepared data"
    monkeypatch.setattr(
        cli.preparation,
        "prepare_stats",
        lambda *args: [
            {
                "method": "DPA",
                "preparation": "stats",
                "counts": {
                    "measured_sites": 3,
                    "proteins": 2,
                    "with_structures": 2,
                    "structural_context_matched_sites": 2,
                    "structural_context_models": 2,
                },
            }
        ],
    )

    cli.prepare_stats("DPA", output, input_file=source)

    assert capsys.readouterr().out.splitlines() == [
        "Prepared DPA: 3 measured sites, 2 proteins, 2 structures",
        "  Structural context: 2 matched sites across 2 models",
        f"  Folder: {output / 'DPA'}",
        f"  Serve: proptm3d serve DPA '{output}'",
    ]


def test_cli_prepare_reports_dpu_complete_results(tmp_path, monkeypatch, capsys):
    source = tmp_path / "statistics.zip"
    source.touch()
    monkeypatch.setattr(
        cli.preparation,
        "prepare_stats",
        lambda *args: [
            {
                "method": "DPU",
                "preparation": "stats",
                "counts": {
                    "complete_result_sites": 5,
                    "complete_result_proteins": 2,
                    "complete_result_structures": 2,
                    "measured_sites_without_result": 3,
                    "structural_context_matched_sites": 2,
                    "structural_context_models": 2,
                },
            }
        ],
    )

    cli.prepare_stats("DPU", tmp_path, input_file=source)

    output = capsys.readouterr().out
    assert "Prepared DPU: 5 sites with fold change and FDR, 2 proteins, 2 structures" in output
    assert "3 measured sites without a complete DPU result remain in the catalog" in output


def test_cli_prepare_gsea_sets_up_stats_and_gsea(tmp_path, monkeypatch, capsys):
    source = tmp_path / "complete.zip"
    source.touch()
    received = []

    def prepare_gsea(*args):
        received.append(args)
        return [
            {
                "method": "DPA",
                "preparation": "gsea",
                "counts": {
                    "measured_sites": 3,
                    "proteins": 2,
                    "with_structures": 2,
                    "structural_context_matched_sites": 2,
                    "structural_context_models": 2,
                    "gsea_terms": 7,
                    "gsea_sources": 3,
                },
            }
        ]

    monkeypatch.setattr(cli.preparation, "prepare_gsea", prepare_gsea)

    cli.prepare_gsea("DPA", tmp_path, input_file=source)

    assert received == [(source, tmp_path, ("DPA",))]
    output = capsys.readouterr().out
    assert "Structural context: 2 matched sites across 2 models" in output
    assert "GSEA: 7 terms across 3 sources" in output


def test_cli_caches_complete_proteome_context(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(cli.structural_context_cache, "DEFAULT_CACHE_ROOT", tmp_path)
    received = []

    def precompute(proteome, cache_root):
        received.append((proteome.id, cache_root))
        return {"models": 21_452, "accessions": 21_451}

    monkeypatch.setattr(cli.structural_context_cache, "precompute_archive_context", precompute)

    cli.cache_context("MOUSE")

    assert received == [("UP000000589", tmp_path)]
    output = capsys.readouterr().out
    assert "21452 models across 21451 accessions" in output
    assert "UP000000589_10090_MOUSE_v6.complete.json" in output


def test_cli_caches_structures_and_cleans_one_organism(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(cli.structural_context_cache, "DEFAULT_CACHE_ROOT", tmp_path)
    received = []

    def structures(proteome, cache_root):
        received.append(("structures", proteome.id, cache_root))
        return {"P12345": [{"file": "model.cif.gz"}]}

    def clean(proteome, cache_root):
        received.append(("clean", proteome.id, cache_root))
        return {"models": 1, "files": 4, "bytes": 1024**3}

    monkeypatch.setattr(cli.alphafold_cache, "cache_archive_models", structures)
    monkeypatch.setattr(cli.alphafold_cache, "clean_proteome_cache", clean)

    cli.cache_structures("MOUSE")
    cli.clean_cache("MOUSE")

    assert received == [
        ("structures", "UP000000589", tmp_path),
        ("clean", "UP000000589", tmp_path),
    ]
    output = capsys.readouterr().out
    assert "Cached 1 AlphaFold structure models" in output
    assert "Removed 4 cached files (1.00 GiB)" in output
