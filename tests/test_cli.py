"""Tests for the prepare, clean, cache, upload, and serve command line interface."""

from types import SimpleNamespace

import pytest

from proptm3d import cli


@pytest.fixture(autouse=True)
def isolated_prepared_history(tmp_path, monkeypatch):
    monkeypatch.setattr(cli.prepared_history, "history_path", lambda: tmp_path / "history.json")
    monkeypatch.setattr(cli.upload_cache, "cache_path", lambda: tmp_path / "uploads.json")


def test_cli_prepare_and_clean_select_folders(tmp_path, monkeypatch):
    calls = []
    (tmp_path / "PTM_statistics.h5mu").touch()
    output = tmp_path / "viewer"

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
        cli.prepared_root,
        "clean_prepared_root",
        lambda folder: calls.append(("clean", folder)) or folder.resolve(),
    )
    with pytest.raises(SystemExit, match="0"):
        cli.app(
            [
                "prepare",
                "stats",
                "DPU",
                str(output),
                "--input",
                str(tmp_path / "PTM_statistics.h5mu"),
            ]
        )
    with pytest.raises(SystemExit, match="0"):
        cli.app(["prepare", "stats", str(output), "--input", str(tmp_path / "PTM_statistics.h5mu")])
    with pytest.raises(SystemExit, match="0"):
        cli.app(["clean", str(output)])
    assert calls[0][-1] == ("DPU",)
    assert calls[0][2] == output
    assert calls[1][-1] == ("DPA", "DPU", "CF-DPU")
    assert calls[1][2] == output
    assert calls[2] == ("clean", output)
    assert cli.prepared_history.prepared_folders() == ()


def test_cli_prepare_defaults_output_beside_input(tmp_path, monkeypatch):
    input_file = tmp_path / "PTM_HIF2a_mutant_vs_GFP_control.zip"
    input_file.touch()
    calls = []
    monkeypatch.setattr(
        cli.preparation,
        "prepare_stats",
        lambda input_file, output_dir, methods: (
            calls.append((input_file, output_dir, methods)) or []
        ),
    )

    with pytest.raises(SystemExit, match="0"):
        cli.app(["prepare", "stats", "--input", str(input_file)])
    with pytest.raises(SystemExit, match="0"):
        cli.app(["prepare", "stats", "DPA", "--input", str(input_file)])

    default_output = tmp_path / "proptm3d_PTM_HIF2a_mutant_vs_GFP_control"
    assert calls == [
        (input_file, default_output, ("DPA", "DPU", "CF-DPU")),
        (input_file, default_output, ("DPA",)),
    ]


def test_cli_bare_help_and_serve_requires_method_and_folder(capsys):
    with pytest.raises(SystemExit) as excinfo:
        cli.app([])
    assert excinfo.value.code == 0
    help_text = capsys.readouterr().out
    assert "prepare" in help_text
    assert "cache" in help_text
    assert "bundle" in help_text
    assert "upload" in help_text
    with pytest.raises(SystemExit) as excinfo:
        cli.app(["serve"])
    assert excinfo.value.code != 0


def test_cli_upload_reports_bfabric_workunit_and_resource(tmp_path, monkeypatch, capsys):
    bundle = tmp_path / "viewer.zip"
    calls = []

    def upload_artifacts(artifacts, order_id, workunit_name, *, progress):
        calls.append((artifacts, order_id, workunit_name, progress))
        return (
            SimpleNamespace(
                artifact=artifacts[0],
                summary=SimpleNamespace(
                    workunit_id=456,
                    uploads=[SimpleNamespace(resource_id=789)],
                ),
            ),
        )

    monkeypatch.setattr(
        cli.bfabric_upload,
        "upload_artifacts",
        upload_artifacts,
    )

    with pytest.raises(SystemExit, match="0"):
        cli.app(
            [
                "upload",
                "123",
                "proptm3d viewer",
                str(bundle),
            ]
        )

    assert len(calls) == 1
    artifacts, order_id, workunit_name, progress = calls[0]
    assert artifacts == (cli.bfabric_upload.Proptm3dArtifact(bundle),)
    assert (order_id, workunit_name) == (123, "proptm3d viewer")
    assert progress is None
    output = capsys.readouterr().out
    assert "to proptm3d" in output
    assert "Workunit: 456" in output
    assert "Resource: 789" in output


@pytest.mark.parametrize(
    ("answers", "replace_pair", "uploads"),
    [
        (("yes", "yes"), False, 1),
        (("yes", "n"), False, 0),
        (("n", "manual-pipeline", "manual-proptm3d", "yes"), True, 1),
    ],
)
def test_cli_upload_discovers_and_confirms_cached_pair(
    tmp_path, monkeypatch, capsys, answers, replace_pair, uploads
):
    pipeline = tmp_path / "PTM_results.zip"
    bundle = tmp_path / "proptm3d-results.zip"
    pipeline.touch()
    bundle.touch()
    pair = cli.upload_cache.UploadPair(tmp_path / "prepared", pipeline, bundle)
    manual_pipeline = tmp_path / "manual-pipeline"
    manual_bundle = tmp_path / "manual-proptm3d"
    manual_pipeline.touch()
    manual_bundle.touch()
    manual_pair = cli.upload_cache.UploadPair(tmp_path / "manual", manual_pipeline, manual_bundle)

    def artifacts_for(selected):
        return (
            SimpleNamespace(
                path=selected.pipeline_zip,
                application_name="PTM Pipeline",
                application_id=431,
                validate=lambda: selected.pipeline_zip,
            ),
            SimpleNamespace(
                path=selected.proptm3d_zip,
                application_name="proptm3d",
                application_id=434,
                validate=lambda: selected.proptm3d_zip,
            ),
        )

    calls = []
    recorded = []
    responses = iter(answers)
    monkeypatch.setattr(cli.upload_cache, "latest_upload_pair", lambda _roots: pair)
    monkeypatch.setattr(cli.upload_cache, "pair_from_paths", lambda *_paths: manual_pair)
    monkeypatch.setattr(cli.upload_cache, "record_pair", recorded.append)
    monkeypatch.setattr(cli.bfabric_upload, "artifacts_for", artifacts_for)
    monkeypatch.setattr("builtins.input", lambda _prompt: next(responses))
    monkeypatch.setattr(
        cli.bfabric_upload,
        "upload_pair",
        lambda *args, **_kwargs: (
            calls.append(args)
            or tuple(
                SimpleNamespace(
                    artifact=artifact,
                    summary=SimpleNamespace(
                        workunit_id=450 + index,
                        uploads=[SimpleNamespace(resource_id=780 + index)],
                    ),
                )
                for index, artifact in enumerate(artifacts_for(args[0]), start=1)
            )
        ),
    )

    with pytest.raises(SystemExit, match="0"):
        cli.app(["upload", "43037", "ptm-pipeline_analysis_v3"])

    assert len(calls) == uploads
    selected_pair = manual_pair if replace_pair else pair
    if uploads:
        assert calls[0][0] == selected_pair
    assert recorded == ([manual_pair] if replace_pair else [])
    output = capsys.readouterr().out
    assert "application 431" in output
    assert "application 434" in output
    if uploads:
        assert f"Uploaded {selected_pair.pipeline_zip.name} to PTM Pipeline" in output
        assert f"Uploaded {selected_pair.proptm3d_zip.name} to proptm3d" in output
    else:
        assert "Upload cancelled." in output


def test_cli_upload_reports_expected_failure_without_traceback(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(
        cli.bfabric_upload,
        "upload_artifacts",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("OAuth token lacks tus scope")
        ),
    )

    with pytest.raises(SystemExit) as error:
        cli.app(
            [
                "upload",
                "123",
                "viewer",
                str(tmp_path / "viewer.zip"),
            ]
        )

    assert error.value.code == 2
    output = capsys.readouterr().err
    assert output.strip() == "OAuth token lacks tus scope"
    assert "Traceback" not in output


def test_terminal_upload_progress_reports_start_bytes_and_completion():
    class ProgressSpy:
        def __init__(self):
            self.console = SimpleNamespace(print=lambda message: self.prints.append(message))
            self.prints = []
            self.added = []
            self.updated = []

        def add_task(self, description, *, total):
            self.added.append((description, total))
            return len(self.added) - 1

        def update(self, task_id, **fields):
            self.updated.append((task_id, fields))

    progress = ProgressSpy()
    reporter = cli._TerminalUploadProgress(progress)

    reporter.on_start(1, 2 * 1024**2)
    reporter.on_progress("viewer.zip", 1024**2, 2 * 1024**2)
    reporter.on_file_done("viewer.zip", True)

    assert progress.prints == ["Starting transfer: 1 file, 2.0 MiB"]
    assert progress.added == [("viewer.zip", 2 * 1024**2)]
    assert progress.updated[0] == (
        0,
        {"completed": 1024**2, "total": 2 * 1024**2},
    )
    assert progress.updated[1] == (
        0,
        {
            "completed": 2 * 1024**2,
            "description": "[green]✓[/] viewer.zip",
            "refresh": True,
        },
    )


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
