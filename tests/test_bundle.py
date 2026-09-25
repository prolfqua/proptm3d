"""Portable bundle layouts, prepared-folder history, and safe root cleanup."""

import gzip
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
import threading
from pathlib import Path
from urllib.request import urlopen
from zipfile import ZipFile

import polars as pl
import pytest

from proptm3d import bundle, cli, prepared_history, prepared_root, webapp
from proptm3d.prepare import MANIFEST_KIND


@pytest.fixture(autouse=True)
def isolated_prepared_history(tmp_path, monkeypatch):
    monkeypatch.setattr(
        prepared_history, "history_path", lambda: tmp_path / "state" / "folders.json"
    )


@pytest.fixture
def prepared_folder(tmp_path):
    root = tmp_path / "viewer"
    cache = tmp_path / "cache"
    structures = cache / "structures"
    pae = cache / "pae"
    contexts = cache / "structural_context" / "bludau-v1"
    structures.mkdir(parents=True)
    pae.mkdir()
    contexts.mkdir(parents=True)
    pl.DataFrame(
        {"fragment": [1], "position": [2], "is_exposed": [True], "is_idr": [False]}
    ).write_parquet(contexts / "AF-P12345-F1-model_v6.parquet")
    with gzip.open(structures / "AF-P12345-F1-model_v6.cif.gz", "wb") as stream:
        stream.write(b"data_P12345\n")
    with gzip.open(pae / "AF-P12345-F1-predicted_aligned_error_v6.json.gz", "wb") as stream:
        stream.write(b"[]")

    def add_method(method):
        folder = root / method
        (folder / "data" / "plot_backgrounds").mkdir(parents=True)
        (folder / "tables").mkdir()
        (folder / "assets").mkdir()
        (folder / "pae").mkdir()
        (folder / "residue_context").mkdir()
        (folder / "structures").symlink_to(structures, target_is_directory=True)
        (folder / "pae" / "AF-P12345-F1-predicted_aligned_error_v6.json.gz").symlink_to(
            pae / "AF-P12345-F1-predicted_aligned_error_v6.json.gz"
        )
        (folder / "residue_context" / "AF-P12345-F1-model_v6.parquet").symlink_to(
            contexts / "AF-P12345-F1-model_v6.parquet"
        )
        pl.DataFrame(
            {
                "url": ["structures/AF-P12345-F1-model_v6.cif.gz"],
                "pae_url": ["pae/AF-P12345-F1-predicted_aligned_error_v6.json.gz"],
                "context_url": ["residue_context/AF-P12345-F1-model_v6.parquet"],
            }
        ).write_parquet(folder / "tables" / "structures.parquet")
        pl.DataFrame(
            {
                "contrast": ["a_vs_b"],
                "effect": [1.5],
                "fdr": [0.01],
                "protein_fc": [1.0],
                "original_site_fc": [1.5],
            }
        ).write_parquet(folder / "tables" / "site_stats.parquet")
        (folder / "data" / "run.json").write_text(
            json.dumps(
                {
                    "kind": MANIFEST_KIND,
                    "method": method,
                    "files": {
                        "structures_parquet": "tables/structures.parquet",
                        "site_stats_parquet": "tables/site_stats.parquet",
                    },
                    "contrasts": ["a_vs_b"],
                    "samples": [
                        {"sample": "sample_1", "condition": "a"},
                        {"sample": "sample_2", "condition": "b"},
                    ],
                    "proteome": "UP000000589",
                    "uniprot_release": "2026_03",
                    "alphafold_archive_version": "v6",
                    "counts": {
                        "proteins": 1,
                        "measured_sites": 2,
                        "complete_result_sites": 1,
                    },
                }
            )
        )
        (folder / "index.html").write_text(
            '<!doctype html><script type="module" src="./assets/index-ABC123.js"></script>'
            "<ptm-browser-app></ptm-browser-app>"
        )
        (folder / "favicon.svg").write_text("<svg></svg>")
        (folder / "assets" / "index-ABC123.js").write_text("export const ready = true")
        (folder / "assets" / "src-DEF456.js").write_text("export const chunk = true")
        (folder / "data" / "browser-assets.json").write_text(
            json.dumps(
                {
                    "schema_version": "1",
                    "files": ["assets/index-ABC123.js", "assets/src-DEF456.js"],
                }
            )
        )
        for name in ("volcano-0.png", "protein-site-0.png"):
            (folder / "data" / "plot_backgrounds" / name).write_bytes(b"png")
        (folder / "data" / "plot_backgrounds.json").write_text(
            json.dumps(
                {
                    "plots": {
                        "a_vs_b": {
                            "volcano": {"file": "data/plot_backgrounds/volcano-0.png"},
                            "protein_site": {"file": "data/plot_backgrounds/protein-site-0.png"},
                        }
                    }
                }
            )
        )
        return folder

    return root, cache, add_method


def test_single_and_all_method_bundles_are_portable(prepared_folder, tmp_path):
    root, cache, add_method = prepared_folder
    add_method("DPA")
    add_method("DPU")

    single = bundle.bundle_prepared_root(root, "DPA")
    combined = bundle.bundle_prepared_root(root)
    assert single == tmp_path / "viewer-DPA.zip"
    assert combined == tmp_path / "viewer-all.zip"

    with ZipFile(single) as archive:
        names = set(archive.namelist())
        assert "index.html" in names
        assert set(bundle.SERVER_FILES).issubset(names)
        assert "DPA/index.html" not in names
        assert "shared/structures/AF-P12345-F1-model_v6.cif.gz" in names
        assert "shared/pae/AF-P12345-F1-predicted_aligned_error_v6.json.gz" in names
        assert "shared/residue_context/AF-P12345-F1-model_v6.parquet" in names
        table = pl.read_parquet(archive.read("tables/structures.parquet"))
        assert table["url"].item() == "shared/structures/AF-P12345-F1-model_v6.cif.gz"
        assert table["pae_url"].item() == (
            "shared/pae/AF-P12345-F1-predicted_aligned_error_v6.json.gz"
        )
        assert table["context_url"].item() == "shared/residue_context/AF-P12345-F1-model_v6.parquet"
        assert all(stat.S_ISREG(item.external_attr >> 16) for item in archive.infolist())
        archive.extractall(tmp_path / "single")
    with ZipFile(combined) as archive:
        names = set(archive.namelist())
        assert "index.html" in names
        assert set(bundle.SERVER_FILES).issubset(names)
        assert {"DPA/index.html", "DPU/index.html"}.issubset(names)
        assert "CF-DPU/index.html" not in names
        assert "DPA/structures/AF-P12345-F1-model_v6.cif.gz" not in names
        assert "DPU/pae/AF-P12345-F1-predicted_aligned_error_v6.json.gz" not in names
        assert "shared/structures/AF-P12345-F1-model_v6.cif.gz" in names
        assert "shared/pae/AF-P12345-F1-predicted_aligned_error_v6.json.gz" in names
        assert "shared/residue_context/AF-P12345-F1-model_v6.parquet" in names
        for method in ("DPA", "DPU"):
            table = pl.read_parquet(archive.read(f"{method}/tables/structures.parquet"))
            assert table["url"].item() == "../shared/structures/AF-P12345-F1-model_v6.cif.gz"
            assert table["pae_url"].item() == (
                "../shared/pae/AF-P12345-F1-predicted_aligned_error_v6.json.gz"
            )
            assert (
                table["context_url"].item()
                == "../shared/residue_context/AF-P12345-F1-model_v6.parquet"
            )
        overview = archive.read("index.html").decode()
        assert '<html lang="en">' in overview
        assert "<head>" in overview
        assert "<body>" in overview
        assert "</body>" in overview
        assert "<table>" in overview
        assert "<tbody>" in overview
        assert 'href="DPA/index.html"' in overview
        assert 'href="DPU/index.html"' in overview
        assert "Differential PTM abundance" in overview
        assert "Differential PTM usage" in overview
        assert "<strong>2</strong><span>Groups</span>" in overview
        assert "<strong>1</strong><span>Contrast</span>" in overview
        assert "<strong>1 + 1</strong><span>Samples by group</span>" in overview
        assert "Paired enriched + total measurements" in overview
        assert 'class="number">2</td>' in overview
        assert 'class="number">1</td>' in overview
        assert "UP000000589" in overview
        assert "{{" not in overview
        assert "<script" not in overview
        archive.extractall(tmp_path / "all")

    cache.rename(tmp_path / "cache-gone")
    with webapp.create_server(tmp_path / "all") as server:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            base = f"http://127.0.0.1:{server.server_address[1]}"
            with urlopen(base + "/index.html") as response:
                assert b"Choose an analysis method" in response.read()
            with urlopen(base + "/DPA/index.html") as response:
                assert b"<ptm-browser-app>" in response.read()
            with urlopen(base + "/DPA/tables/structures.parquet") as response:
                assert pl.read_parquet(response.read()).height == 1
            with urlopen(base + "/DPA/assets/index-ABC123.js") as response:
                assert b"ready" in response.read()
            with urlopen(base + "/shared/structures/AF-P12345-F1-model_v6.cif.gz") as response:
                assert gzip.decompress(response.read()) == b"data_P12345\n"
            with urlopen(
                base + "/shared/pae/AF-P12345-F1-predicted_aligned_error_v6.json.gz"
            ) as response:
                assert gzip.decompress(response.read()) == b"[]"
        finally:
            server.shutdown()
            worker.join()


def test_selected_methods_share_models_and_leave_prepared_tables_unchanged(prepared_folder):
    root, _, add_method = prepared_folder
    for method in ("DPA", "DPU", "CF-DPU"):
        add_method(method)

    archive_path = bundle.bundle_prepared_root(root, ("DPA", "DPU"))
    assert archive_path.name == "viewer-DPA-DPU.zip"
    with ZipFile(archive_path) as archive:
        names = archive.namelist()
        assert json.loads(archive.read("bundle.json"))["methods"] == ["DPA", "DPU"]
        assert "CF-DPU/index.html" not in names
        assert names.count("shared/structures/AF-P12345-F1-model_v6.cif.gz") == 1
        assert names.count("shared/pae/AF-P12345-F1-predicted_aligned_error_v6.json.gz") == 1
        assert names.count("shared/residue_context/AF-P12345-F1-model_v6.parquet") == 1
        for method in ("DPA", "DPU"):
            table = pl.read_parquet(archive.read(f"{method}/tables/structures.parquet"))
            assert table["url"].item().startswith("../shared/structures/")
    for method in ("DPA", "DPU", "CF-DPU"):
        table = pl.read_parquet(root / method / "tables" / "structures.parquet")
        assert table["url"].item().startswith("structures/")


@pytest.mark.parametrize("method", ["DPA", None])
def test_default_bundle_server_serves_extracted_site(prepared_folder, tmp_path, method):
    root, _, add_method = prepared_folder
    add_method("DPA")
    if method is None:
        add_method("DPU")
    archive_path = bundle.bundle_prepared_root(root, method)
    target = tmp_path / ("single-server" if method else "all-server")

    with ZipFile(archive_path) as archive:
        names = set(archive.namelist())
        assert set(bundle.SERVER_FILES).issubset(names)
        assert b"\r\n" in archive.read("serve.bat")
        assert stat.S_IMODE(archive.getinfo("serve.sh").external_attr >> 16) & stat.S_IXUSR
        archive.extractall(target)

    result = subprocess.run(
        [sys.executable, str(target / "serve.py"), "--help"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
    )
    assert "--port" in result.stdout
    shell_result = subprocess.run(
        ["sh", str(target / "serve.sh"), "--help"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
    )
    assert "--port" in shell_result.stdout

    spec = importlib.util.spec_from_file_location("bundle_server", target / "serve.py")
    assert spec is not None
    assert spec.loader is not None
    server_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server_module)
    with server_module.create_server(port=0) as server:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            prefix = "" if method else "DPA/"
            base = f"http://127.0.0.1:{server.server_address[1]}/{prefix}"
            with urlopen(base + "index.html") as response:
                assert b"<ptm-browser-app>" in response.read()
                assert response.headers["Cache-Control"] == "no-cache"
            with urlopen(base + "tables/site_stats.parquet") as response:
                assert pl.read_parquet(response.read()).height == 1
        finally:
            server.shutdown()
            worker.join()


def test_bundle_can_omit_server_launchers(prepared_folder):
    root, _, add_method = prepared_folder
    add_method("DPA")
    with ZipFile(bundle.bundle_prepared_root(root, "DPA", include_server=False)) as archive:
        assert not set(bundle.SERVER_FILES).intersection(archive.namelist())


@pytest.mark.parametrize("method", ["DPA", None])
def test_serve_bundle_extracts_temporarily(prepared_folder, monkeypatch, method):
    root, _, add_method = prepared_folder
    add_method("DPA")
    if method is None:
        add_method("DPU")
    archive_path = bundle.bundle_prepared_root(root, method)
    served = []

    def capture_server(directory, port):
        served.append(Path(directory))
        assert port == 8123
        assert (directory / "index.html").is_file()
        method_root = directory if method is not None else directory / "DPA"
        assert (method_root / "data" / "run.json").is_file()
        assert (method_root / "assets" / "index-ABC123.js").is_file()

    monkeypatch.setattr(cli.webapp, "serve", capture_server)
    with pytest.raises(SystemExit, match="0"):
        cli.app(["serve", str(archive_path), "--port", "8123"])
    assert len(served) == 1
    assert not served[0].exists()


def test_serve_prepared_root_uses_same_landing_page_without_creating_files(
    prepared_folder, monkeypatch
):
    root, _, add_method = prepared_folder
    add_method("DPA")
    add_method("DPU")
    add_method("CF-DPU")
    served = []

    def capture_server(directory, port, *, landing_page):
        served.append((directory, port, landing_page))

    monkeypatch.setattr(cli.webapp, "serve", capture_server)
    with pytest.raises(SystemExit, match="0"):
        cli.app(["serve", str(root), "--port", "8123"])
    assert len(served) == 1
    directory, port, landing_page = served[0]
    assert directory == root.resolve()
    assert port == 8123
    assert landing_page == bundle.method_chooser_html(root, ("DPA", "DPU", "CF-DPU"))
    assert not (root / "index.html").exists()
    assert prepared_history.prepared_folders() == (root.resolve(),)


def test_overview_counts_samples_once_across_methods_and_labels_groups(prepared_folder):
    root, _, add_method = prepared_folder
    for method in ("DPA", "DPU"):
        folder = add_method(method)
        manifest_path = folder / "data" / "run.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["samples"] = [
            {"sample": f"control_{index}", "condition": "GFP control"} for index in range(6)
        ] + [{"sample": f"mutant_{index}", "condition": "HIF2a mutant"} for index in range(6)]
        manifest_path.write_text(json.dumps(manifest))

    overview = bundle.method_chooser_html(root, ("DPA", "DPU"))
    assert "<strong>2</strong><span>Groups</span>" in overview
    assert "<strong>1</strong><span>Contrast</span>" in overview
    assert "<strong>6 + 6</strong><span>Samples by group</span>" in overview
    assert "GFP control: 6 · HIF2a mutant: 6" in overview
    assert "Paired enriched + total measurements" in overview
    assert "<strong>24</strong>" not in overview


def test_serve_prepared_root_rejects_unrelated_entries_and_symlinks(prepared_folder, tmp_path):
    root, _, add_method = prepared_folder
    add_method("DPA")
    (root / "notes.txt").write_text("private")
    with pytest.raises(ValueError, match="Not a prepared output folder"):
        cli.serve(str(root))
    (root / "notes.txt").unlink()
    alias = tmp_path / "alias"
    alias.symlink_to(root, target_is_directory=True)
    with pytest.raises(ValueError, match="symlinked prepared folder"):
        cli.serve(str(alias))


def test_serve_bundle_rejects_unsafe_zip_entries(prepared_folder, tmp_path):
    root, _, add_method = prepared_folder
    add_method("DPA")
    archive_path = bundle.bundle_prepared_root(root, "DPA")
    unsafe = tmp_path / "unsafe.zip"
    with ZipFile(archive_path) as original, ZipFile(unsafe, "w") as target:
        for item in original.infolist():
            target.writestr(item, original.read(item))
        target.writestr("../escape.txt", "bad")

    with pytest.raises(ValueError, match="Unsafe bundle entries"), bundle.extracted_bundle(unsafe):
        pytest.fail("Unsafe bundle was extracted")
    assert not (tmp_path / "escape.txt").exists()


@pytest.mark.parametrize(
    ("omitted", "error"),
    [("bundle.json", "Not a proptm3d browser bundle"), ("index.html", "Incomplete")],
)
def test_serve_bundle_rejects_missing_required_files(prepared_folder, tmp_path, omitted, error):
    root, _, add_method = prepared_folder
    add_method("DPA")
    archive_path = bundle.bundle_prepared_root(root, "DPA")
    incomplete = tmp_path / "incomplete.zip"
    with ZipFile(archive_path) as original, ZipFile(incomplete, "w") as target:
        for item in original.infolist():
            if item.filename != omitted:
                target.writestr(item, original.read(item))

    with pytest.raises(ValueError, match=error), bundle.extracted_bundle(incomplete):
        pytest.fail("Incomplete bundle was extracted")


def test_bundle_refuses_placeholder_missing_asset_and_existing_output(prepared_folder, tmp_path):
    root, _, add_method = prepared_folder
    folder = add_method("DPA")
    destination = tmp_path / "custom.zip"
    (folder / "index.html").write_text("Prepared data is available")
    with pytest.raises(ValueError, match="not deployed"):
        bundle.bundle_prepared_root(root, "DPA", destination)
    assert not destination.exists()

    (folder / "index.html").write_text("<ptm-browser-app></ptm-browser-app>")
    (folder / "assets" / "index-ABC123.js").unlink()
    with pytest.raises(ValueError, match="Missing prepared file"):
        bundle.bundle_prepared_root(root, "DPA", destination)
    (folder / "assets" / "index-ABC123.js").write_text("export {}")
    destination.write_text("keep")
    with pytest.raises(FileExistsError, match="overwrite"):
        bundle.bundle_prepared_root(root, "DPA", destination)
    assert destination.read_text() == "keep"


def test_bundle_refuses_missing_chunk_while_other_assets_remain(prepared_folder, tmp_path):
    root, _, add_method = prepared_folder
    folder = add_method("DPA")
    (folder / "assets" / "src-DEF456.js").unlink()

    with pytest.raises(ValueError, match="Missing prepared file"):
        bundle.bundle_prepared_root(root, "DPA")

    assert not (tmp_path / "viewer-DPA.zip").exists()


@pytest.mark.parametrize(
    "inventory",
    [
        {"schema_version": "2", "files": ["assets/index-ABC123.js"]},
        {"schema_version": "1", "files": []},
        {"schema_version": "1", "files": [123]},
        {"schema_version": "1", "files": ["../index-ABC123.js"]},
        {"schema_version": "1", "files": ["assets/unhashed.js"]},
    ],
)
def test_bundle_refuses_invalid_browser_inventory(prepared_folder, inventory):
    root, _, add_method = prepared_folder
    folder = add_method("DPA")
    (folder / "data" / "browser-assets.json").write_text(json.dumps(inventory))

    with pytest.raises(
        ValueError, match=r"Invalid browser asset inventory|Unexpected prepared path"
    ):
        bundle.bundle_prepared_root(root, "DPA")


def test_bundle_requires_browser_inventory(prepared_folder):
    root, _, add_method = prepared_folder
    folder = add_method("DPA")
    (folder / "data" / "browser-assets.json").unlink()

    with pytest.raises(ValueError, match="Browser assets are missing"):
        bundle.bundle_prepared_root(root, "DPA")


def test_bundle_refuses_asset_inventory_drift(prepared_folder):
    root, _, add_method = prepared_folder
    folder = add_method("DPA")
    (folder / "assets" / "extra-ABC123.js").write_text("export {}")

    with pytest.raises(ValueError, match="Browser assets differ"):
        bundle.bundle_prepared_root(root, "DPA")


def test_bundle_refuses_missing_index_asset_reference(prepared_folder):
    root, _, add_method = prepared_folder
    folder = add_method("DPA")
    (folder / "index.html").write_text(
        '<!doctype html><script type="module" src="./assets/absent-ABC123.js"></script>'
        "<ptm-browser-app></ptm-browser-app>"
    )

    with pytest.raises(ValueError, match="references missing assets"):
        bundle.bundle_prepared_root(root, "DPA")


def test_bundle_rejects_structure_path_escaping_method(prepared_folder):
    root, _, add_method = prepared_folder
    folder = add_method("DPA")
    pl.DataFrame({"url": ["../secret"], "pae_url": [None], "context_url": [None]}).write_parquet(
        folder / "tables" / "structures.parquet"
    )
    with pytest.raises(ValueError, match="Unexpected prepared path"):
        bundle.bundle_prepared_root(root, "DPA")


def test_previous_preparation_can_be_validated_for_replacement(prepared_folder):
    _, _, add_method = prepared_folder
    folder = add_method("DPA")
    table = folder / "tables" / "structures.parquet"
    pl.read_parquet(table).drop("context_url").write_parquet(table)
    (folder / "residue_context" / "AF-P12345-F1-model_v6.parquet").unlink()
    (folder / "residue_context").rmdir()
    prepared_root.assert_owned_method(folder, "DPA")


def test_history_lists_prepared_folders_and_clean_requires_owned_contents(
    prepared_folder, tmp_path, capsys
):
    root, cache, add_method = prepared_folder
    add_method("DPA")
    prepared_history.register(root)
    with pytest.raises(SystemExit, match="0"):
        cli.app(["bundle"])
    assert f"{root.resolve()}: DPA" in capsys.readouterr().out

    (root / "notes.txt").write_text("keep")
    with pytest.raises(ValueError, match="unrecognized"):
        prepared_root.clean_prepared_root(root)
    assert (root / "notes.txt").is_file()
    (root / "notes.txt").unlink()
    cli.clean(root)
    assert not root.exists()
    assert cache.exists()
    assert prepared_history.prepared_folders() == ()


def test_bundle_cli_lists_unavailable_and_registers_explicit_root(prepared_folder, capsys):
    root, _, add_method = prepared_folder
    add_method("DPA")
    with pytest.raises(SystemExit, match="0"):
        cli.app(["bundle", "DPA", "--in", str(root)])
    assert prepared_history.prepared_folders() == (root.resolve(),)
    assert "viewer-DPA.zip" in capsys.readouterr().out
    with pytest.raises(SystemExit, match="0"):
        cli.app(["bundle"])
    assert f"{root.resolve()}: DPA" in capsys.readouterr().out


def test_bundle_cli_selects_multiple_methods(prepared_folder, capsys):
    root, _, add_method = prepared_folder
    for method in ("DPA", "DPU", "CF-DPU"):
        add_method(method)
    with pytest.raises(SystemExit, match="0"):
        cli.app(["bundle", "DPA", "DPU", "--in", str(root)])
    assert "Bundled DPA, DPU" in capsys.readouterr().out
    with ZipFile(root.with_name("viewer-DPA-DPU.zip")) as archive:
        assert "DPA/index.html" in archive.namelist()
        assert "DPU/index.html" in archive.namelist()
        assert "CF-DPU/index.html" not in archive.namelist()


def test_bundle_cli_reports_existing_zip_without_traceback(prepared_folder, capsys):
    root, _, add_method = prepared_folder
    add_method("DPA")
    destination = root.with_name("existing.zip")
    destination.write_bytes(b"keep")

    with pytest.raises(SystemExit) as error:
        cli.app(["bundle", "DPA", "--in", str(root), "--out", str(destination)])

    assert error.value.code == 2
    output = capsys.readouterr()
    assert str(destination) in output.err
    assert "another --out path" in output.err
    assert "Traceback" not in output.err
    assert destination.read_bytes() == b"keep"


def test_bundle_cli_includes_server_by_default_and_allows_opt_out(prepared_folder):
    root, _, add_method = prepared_folder
    add_method("DPA")
    with pytest.raises(SystemExit, match="0"):
        cli.app(["bundle", "DPA", "--in", str(root)])
    with ZipFile(root.with_name("viewer-DPA.zip")) as archive:
        assert set(bundle.SERVER_FILES).issubset(archive.namelist())
    without_server = root.with_name("without-server.zip")
    with pytest.raises(SystemExit, match="0"):
        cli.app(
            [
                "bundle",
                "DPA",
                "--in",
                str(root),
                "--out",
                str(without_server),
                "--no-include-server",
            ]
        )
    with ZipFile(without_server) as archive:
        assert not set(bundle.SERVER_FILES).intersection(archive.namelist())


def test_bundle_validates_root_method_and_destination(prepared_folder, tmp_path):
    root, _, add_method = prepared_folder
    with pytest.raises(ValueError, match="Not a prepared output folder"):
        bundle.bundle_prepared_root(root)
    root.mkdir()
    with pytest.raises(ValueError, match="No prepared methods"):
        bundle.bundle_prepared_root(root)
    add_method("DPA")
    with pytest.raises(ValueError, match="No prepared DPU"):
        bundle.bundle_prepared_root(root, "DPU")
    with pytest.raises(ValueError, match="distinct prepared methods"):
        bundle.bundle_prepared_root(root, ("DPA", "DPA"))
    with pytest.raises(ValueError, match=r"must be a \.zip"):
        bundle.bundle_prepared_root(root, "DPA", tmp_path / "bundle.tar")
    with pytest.raises(ValueError, match="outside the prepared folder"):
        bundle.bundle_prepared_root(root, "DPA", root / "bundle.zip")
    with pytest.raises(FileNotFoundError, match="does not exist"):
        bundle.bundle_prepared_root(root, "DPA", tmp_path / "missing" / "bundle.zip")


def test_bundle_fails_when_referenced_model_or_background_is_missing(prepared_folder, tmp_path):
    root, cache, add_method = prepared_folder
    folder = add_method("DPA")
    model = cache / "structures" / "AF-P12345-F1-model_v6.cif.gz"
    model.unlink()
    with pytest.raises(ValueError, match="Missing prepared file"):
        bundle.bundle_prepared_root(root, "DPA", tmp_path / "missing-model.zip")
    assert not (tmp_path / "missing-model.zip").exists()

    with gzip.open(model, "wb") as stream:
        stream.write(b"data_P12345\n")
    (folder / "data" / "plot_backgrounds.json").unlink()
    with pytest.raises(ValueError, match="Plot backgrounds are missing"):
        bundle.bundle_prepared_root(root, "DPA")
    assert not (tmp_path / "viewer-DPA.zip").exists()


def test_clean_refuses_unrecognized_method_contents(prepared_folder):
    root, cache, add_method = prepared_folder
    folder = add_method("DPA")
    (folder / "notes.txt").write_text("keep")
    with pytest.raises(ValueError, match="unrecognized files"):
        prepared_root.clean_prepared_root(root)
    assert (folder / "notes.txt").read_text() == "keep"
    assert cache.exists()


def test_clean_refuses_missing_generated_layout(prepared_folder):
    root, _, add_method = prepared_folder
    folder = add_method("DPA")
    (folder / "structures").unlink()
    with pytest.raises(ValueError, match="Missing prepared structure link"):
        prepared_root.clean_prepared_root(root)
    assert root.exists()


def test_history_rejects_corruption_and_bundle_requires_input(tmp_path, capsys):
    history = prepared_history.history_path()
    history.parent.mkdir(parents=True)
    history.write_text('{"kind": "incorrect", "folders": []}')
    with pytest.raises(ValueError, match="Invalid prepared-folder history"):
        prepared_history.prepared_folders()
    history.unlink()
    with pytest.raises(SystemExit, match="0"):
        cli.app(["bundle"])
    assert "No prepared folders" in capsys.readouterr().out
    with pytest.raises(ValueError, match="Pass --in FOLDER"):
        cli.bundle("DPA")


def test_bundle_refuses_unrecognized_browser_asset(prepared_folder):
    root, _, add_method = prepared_folder
    folder = add_method("DPA")
    (folder / "assets" / "notes.txt").write_text("keep")
    with pytest.raises(ValueError, match="Unrecognized browser asset"):
        bundle.bundle_prepared_root(root, "DPA")


def test_bundle_rejects_links_to_unrelated_files(prepared_folder, tmp_path):
    root, _, add_method = prepared_folder
    folder = add_method("DPA")
    pae_link = folder / "pae" / "AF-P12345-F1-predicted_aligned_error_v6.json.gz"
    pae_link.unlink()
    unrelated = tmp_path / "unrelated.json.gz"
    unrelated.write_bytes(b"secret")
    pae_link.symlink_to(unrelated)
    with pytest.raises(ValueError, match="Unexpected prepared link"):
        bundle.bundle_prepared_root(root, "DPA")

    pae_link.unlink()
    pae_link.symlink_to(
        tmp_path / "cache" / "pae" / "AF-P12345-F1-predicted_aligned_error_v6.json.gz"
    )
    run_file = folder / "data" / "run.json"
    run_file.rename(tmp_path / "run.json")
    run_file.symlink_to(tmp_path / "run.json")
    with pytest.raises(ValueError, match="Unexpected prepared link"):
        bundle.bundle_prepared_root(root, "DPA")


def test_browser_deploy_accepts_explicit_prepared_root(prepared_folder):
    node = shutil.which("node")
    web_root = Path(__file__).resolve().parents[1] / "web"
    if not os.environ.get("PROPTM3D_DEPLOY_SMOKE"):
        pytest.skip("Node deployment smoke test runs after the browser build")
    assert node is not None, "Node is required for the deployment smoke test"
    assert (web_root / "dist" / "index.html").is_file(), "Build the browser before this test"
    root, _, add_method = prepared_folder
    folder = add_method("DPA")
    subprocess.run(
        [node, str(web_root / "scripts" / "deploy.mjs"), str(root), "DPA"],
        cwd=web_root,
        check=True,
        capture_output=True,
        text=True,
    )
    assert (folder / "data" / "plot_backgrounds.json").is_file()
    asset_manifest = json.loads((folder / "data" / "browser-assets.json").read_text())
    assert asset_manifest["files"]
    assert all((folder / path).is_file() for path in asset_manifest["files"])
    with ZipFile(bundle.bundle_prepared_root(root, "DPA")) as archive:
        assert archive.read("index.html").startswith(b"<!doctype html>")
        assert set(asset_manifest["files"]).issubset(archive.namelist())
