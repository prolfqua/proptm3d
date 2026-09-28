"""Tests for PTM Pipeline and proptm3d uploads to B-Fabric."""

import json
import stat
from zipfile import ZipFile, ZipInfo

import pytest
from bfabric.operations.workunit import FileFailure, FileUpload, UploadSummary

from proptm3d import bfabric_upload
from proptm3d.upload_cache import UploadPair


def _write(archive, name, contents):
    entry = ZipInfo(name)
    entry.external_attr = (stat.S_IFREG | 0o644) << 16
    archive.writestr(entry, contents)


def _bundle(path):
    with ZipFile(path, "w") as archive:
        _write(
            archive,
            "bundle.json",
            json.dumps(
                {
                    "kind": "proptm3d-static-bundle",
                    "schema_version": "1",
                    "layout": "single",
                    "methods": ["DPA"],
                }
            ),
        )
        _write(archive, "index.html", "<ptm-browser-app></ptm-browser-app>")
        _write(archive, "data/run.json", "{}")
    return path


def _pipeline(path):
    with ZipFile(path, "w") as archive:
        _write(archive, "PTM_example/PTM_results.h5mu", b"results")
    return path


def test_upload_pair_uses_shared_credentials_and_separate_applications(tmp_path, monkeypatch):
    pipeline = _pipeline(tmp_path / "PTM_results.zip")
    bundle = _bundle(tmp_path / "proptm3d-results.zip")
    pair = UploadPair(tmp_path / "prepared", pipeline, bundle)
    clients = [object(), object()]
    connections = []
    calls = []
    events = []

    def connect(**kwargs):
        connections.append(kwargs)
        return clients[len(connections) - 1]

    def fake_upload_files(*, client, params, on_start, on_progress, on_file_done):
        calls.append((client, params))
        uploaded = params.files[0].path
        on_start(1, uploaded.stat().st_size)
        on_progress(uploaded.name, uploaded.stat().st_size, uploaded.stat().st_size)
        on_file_done(uploaded.name, True)
        return UploadSummary(
            workunit_id=450 + len(calls),
            uploads=[
                FileUpload(
                    filename=uploaded.name,
                    resource_id=780 + len(calls),
                    storage_path=f"orders/123/{uploaded.name}",
                )
            ],
        )

    monkeypatch.setattr(bfabric_upload.Bfabric, "connect", connect)
    monkeypatch.setattr(bfabric_upload, "upload_files", fake_upload_files)

    progress = bfabric_upload.UploadProgressCallbacks(
        on_start=lambda count, size: events.append(("start", count, size)),
        on_progress=lambda name, done, total: events.append(("progress", name, done, total)),
        on_file_done=lambda name, success: events.append(("done", name, success)),
    )
    receipts = bfabric_upload.upload_pair(
        pair,
        123,
        "ptm-pipeline_analysis_v3",
        progress=progress,
    )

    assert connections == [
        {"config_file_env": "app-431-ptm-pipeline"},
        {"config_file_env": "app-431-ptm-pipeline"},
    ]
    assert [call[1].application_id for call in calls] == [431, 434]
    assert [call[1].files[0].path for call in calls] == [pipeline.resolve(), bundle.resolve()]
    assert all(call[1].container_id == 123 for call in calls)
    assert all(call[1].workunit_name == "ptm-pipeline_analysis_v3" for call in calls)
    assert [receipt.summary.workunit_id for receipt in receipts] == [451, 452]
    assert [event[0] for event in events] == [
        "start",
        "progress",
        "done",
        "start",
        "progress",
        "done",
    ]


def test_upload_pair_validates_both_files_before_connecting(tmp_path, monkeypatch):
    pipeline = tmp_path / "not-a-pipeline.zip"
    with ZipFile(pipeline, "w") as archive:
        _write(archive, "notes.txt", "wrong")
    bundle = _bundle(tmp_path / "viewer.zip")
    pair = UploadPair(tmp_path / "prepared", pipeline, bundle)
    monkeypatch.setattr(
        bfabric_upload.Bfabric,
        "connect",
        lambda **_kwargs: pytest.fail("invalid artifacts must not connect to B-Fabric"),
    )

    with pytest.raises(ValueError, match=r"exactly one PTM_results\.h5mu"):
        bfabric_upload.upload_pair(pair, 123, "viewer")


def test_upload_pair_connects_both_applications_before_creating_workunits(tmp_path, monkeypatch):
    pipeline = _pipeline(tmp_path / "PTM_results.zip")
    bundle = _bundle(tmp_path / "viewer.zip")
    pair = UploadPair(tmp_path / "prepared", pipeline, bundle)
    connections = []

    def connect(**kwargs):
        connections.append(kwargs)
        if len(connections) == 2:
            raise KeyError("app-431-ptm-pipeline")
        return object()

    monkeypatch.setattr(bfabric_upload.Bfabric, "connect", connect)
    monkeypatch.setattr(
        bfabric_upload,
        "upload_files",
        lambda **_kwargs: pytest.fail("no workunit may be created after failed preflight"),
    )

    with pytest.raises(bfabric_upload.UploadConfigurationError, match="app-431-ptm-pipeline"):
        bfabric_upload.upload_pair(pair, 123, "viewer")

    assert connections == [
        {"config_file_env": "app-431-ptm-pipeline"},
        {"config_file_env": "app-431-ptm-pipeline"},
    ]


@pytest.mark.parametrize(
    ("order_id", "workunit_name", "error"),
    [(0, "viewer", "positive integer"), (123, "  ", "must not be empty")],
)
def test_upload_bundle_validates_target_before_connecting(
    tmp_path, monkeypatch, order_id, workunit_name, error
):
    bundle = _bundle(tmp_path / "viewer.zip")
    monkeypatch.setattr(
        bfabric_upload.Bfabric,
        "connect",
        lambda **_kwargs: pytest.fail("invalid input must not connect to B-Fabric"),
    )

    with pytest.raises(ValueError, match=error):
        bfabric_upload.upload_bundle(bundle, order_id, workunit_name)


def test_upload_bundle_uses_proptm3d_application(tmp_path, monkeypatch):
    bundle = _bundle(tmp_path / "viewer.zip")
    connections = []
    calls = []
    monkeypatch.setattr(
        bfabric_upload.Bfabric,
        "connect",
        lambda **kwargs: connections.append(kwargs) or object(),
    )

    def fake_upload_files(*, client, params, **_callbacks):
        calls.append((client, params))
        return UploadSummary(
            workunit_id=456,
            uploads=[FileUpload(filename=bundle.name, resource_id=789, storage_path="viewer.zip")],
        )

    monkeypatch.setattr(bfabric_upload, "upload_files", fake_upload_files)

    summary = bfabric_upload.upload_bundle(bundle, 123, "viewer")

    assert summary.workunit_id == 456
    assert connections == [{"config_file_env": "app-431-ptm-pipeline"}]
    assert calls[0][1].application_id == 434


def test_upload_bundle_validates_archive_before_connecting(tmp_path, monkeypatch):
    archive = tmp_path / "unrelated.zip"
    with ZipFile(archive, "w") as output:
        _write(output, "notes.txt", "not a bundle")
    monkeypatch.setattr(
        bfabric_upload.Bfabric,
        "connect",
        lambda **_kwargs: pytest.fail("invalid bundle must not connect to B-Fabric"),
    )

    with pytest.raises(ValueError, match="Not a proptm3d browser bundle"):
        bfabric_upload.upload_bundle(archive, 123, "viewer")


def test_upload_bundle_reports_created_failed_workunit(tmp_path, monkeypatch):
    bundle = _bundle(tmp_path / "viewer.zip")
    monkeypatch.setattr(bfabric_upload.Bfabric, "connect", lambda **_kwargs: object())
    monkeypatch.setattr(
        bfabric_upload,
        "upload_files",
        lambda **_kwargs: UploadSummary(
            workunit_id=456,
            failures=[FileFailure(filename=bundle.name, resource_id=789, error="transfer stopped")],
        ),
    )

    with pytest.raises(bfabric_upload.BundleUploadError, match=r"workunit 456.*transfer stopped"):
        bfabric_upload.upload_bundle(bundle, 123, "viewer")
