"""Tests for the prepare, clean, cache, and serve command line interface."""

import pytest

from proptm3d import cli


def test_cli_prepare_and_clean_select_methods(tmp_path, monkeypatch):
    calls = []
    (tmp_path / "PTM_statistics.h5mu").touch()
    monkeypatch.chdir(tmp_path)

    def fake_prepare(input_file, output_dir, methods):
        calls.append(("prepare", input_file, output_dir, methods))
        return [
            {
                "method": name,
                "preparation": "stats",
                "counts": {
                    "proteins": 1,
                    "measured_sites": 2,
                    "with_structures": 1,
                    "complete_result_sites": 1,
                    "complete_result_proteins": 1,
                    "complete_result_structures": 1,
                    "measured_sites_without_result": 1,
                    "structural_context_matched_sites": 1,
                    "structural_context_models": 1,
                },
            }
            for name in methods
        ]

    monkeypatch.setattr(cli.preparation, "prepare_stats", fake_prepare)
    monkeypatch.setattr(
        cli.preparation,
        "clean_methods",
        lambda output_dir, methods: calls.append(("clean", output_dir, methods)) or [],
    )
    with pytest.raises(SystemExit, match="0"):
        cli.app(
            [
                "prepare",
                "stats",
                "DPU",
                "--input",
                str(tmp_path / "PTM_statistics.h5mu"),
                "--output-dir",
                str(tmp_path / "out"),
            ]
        )
    with pytest.raises(SystemExit, match="0"):
        cli.app(["prepare", "stats"])
    with pytest.raises(SystemExit, match="0"):
        cli.app(["clean", "CF-DPU"])
    with pytest.raises(SystemExit, match="0"):
        cli.app(["clean"])
    assert calls[0][-1] == ("DPU",)
    assert calls[1][-1] == ("DPA", "DPU", "CF-DPU")
    assert str(calls[1][1]) == "PTM_statistics.h5mu"
    assert calls[2][-1] == ("CF-DPU",)
    assert calls[3][-1] == ("DPA", "DPU", "CF-DPU")


def test_cli_bare_help_and_serve_requires_method(capsys):
    with pytest.raises(SystemExit) as excinfo:
        cli.app([])
    assert excinfo.value.code == 0
    help_text = capsys.readouterr().out
    assert "prepare" in help_text
    assert "cache" in help_text
    with pytest.raises(SystemExit) as excinfo:
        cli.app(["serve"])
    assert excinfo.value.code != 0


def test_cache_help_explains_available_data_and_provenance(capsys):
    with pytest.raises(SystemExit) as error:
        cli.cache_app(["--help"])

    assert error.value.code == 0
    output = " ".join(capsys.readouterr().out.split())
    assert "Supported by proptm3d: HUMAN, MOUSE" in output
    assert "https://alphafold.ebi.ac.uk/download" in output
    assert "Structures and PAE files are downloaded" in output
    assert "pPSE and IDR context is derived locally" in output
    assert "Cache EBI AlphaFold compressed mmCIF structures" in output
    assert "Cache EBI PAE files and locally derive pPSE/IDR" in output


def test_bare_cache_prints_local_availability(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(cli.structural_context_cache, "DEFAULT_CACHE_ROOT", tmp_path)
    monkeypatch.setattr(
        cli.structural_context_cache,
        "cache_statuses",
        lambda cache_root: [
            {
                "organism": "MOUSE",
                "proteome": "UP000000589",
                "structures": {"cached": 21_452, "total": 21_452, "available": True},
                "pae": {"cached": 20_000, "total": 21_452, "available": False},
                "context": {
                    "cached": 20_000,
                    "total": 21_452,
                    "available": False,
                    "algorithm": "bludau-v1",
                },
            },
            {
                "organism": "HUMAN",
                "proteome": "UP000005640",
                "structures": {"cached": 0, "total": 0, "available": False},
                "pae": {"cached": 0, "total": 0, "available": False},
                "context": {
                    "cached": 0,
                    "total": 0,
                    "available": False,
                    "algorithm": "bludau-v1",
                },
            },
        ],
    )

    with pytest.raises(SystemExit) as error:
        cli.app(["cache"])

    assert error.value.code == 0
    output = capsys.readouterr().out
    assert f"Local cache: {tmp_path}" in output
    assert "MOUSE (UP000000589)" in output
    assert "structures  available (21,452 models)" in output
    assert "PAE         partial (20,000/21,452 files)" in output
    assert "context     partial (20,000/21,452 models)" in output
    assert "HUMAN (UP000005640)" in output
    assert output.count("not cached") == 3
