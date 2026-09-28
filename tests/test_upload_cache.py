"""Tests for persistent upload artifact discovery."""

import pytest

from proptm3d import upload_cache


def test_cache_records_preparation_and_bundle_as_one_pair(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_cache, "cache_path", lambda: tmp_path / "state" / "uploads.json")
    pipeline = tmp_path / "PTM_example.zip"
    pipeline.touch()
    root = tmp_path / "proptm3d_PTM_example"
    root.mkdir()
    bundle = tmp_path / "proptm3d_PTM_example-all.zip"
    bundle.touch()

    upload_cache.record_preparation(pipeline, root)
    upload_cache.record_bundle(root, bundle)

    assert upload_cache.latest_upload_pair() == upload_cache.UploadPair(
        root.resolve(), pipeline.resolve(), bundle.resolve()
    )


def test_cache_infers_pair_from_recent_named_prepared_root(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_cache, "cache_path", lambda: tmp_path / "missing.json")
    pipeline = tmp_path / "PTM_example.zip"
    pipeline.touch()
    root = tmp_path / "proptm3d_PTM_example"
    root.mkdir()
    bundle = tmp_path / "proptm3d_PTM_example-all.zip"
    bundle.touch()

    assert upload_cache.latest_upload_pair((tmp_path / "other", root)) == upload_cache.UploadPair(
        root.resolve(), pipeline.resolve(), bundle.resolve()
    )


def test_manual_pair_paths_are_expanded_and_cached(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_cache, "cache_path", lambda: tmp_path / "uploads.json")
    pipeline = tmp_path / "PTM_manual.zip"
    pipeline.touch()
    bundle = tmp_path / "proptm3d_PTM_manual-all.zip"
    bundle.touch()

    pair = upload_cache.pair_from_paths(pipeline, bundle)
    upload_cache.record_pair(pair)

    assert pair.prepared_root == tmp_path / "proptm3d_PTM_manual"
    assert upload_cache.latest_upload_pair() == pair


def test_cache_requires_both_existing_zip_files(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_cache, "cache_path", lambda: tmp_path / "missing.json")
    root = tmp_path / "proptm3d_PTM_example"
    root.mkdir()
    (tmp_path / "PTM_example.zip").touch()

    with pytest.raises(FileNotFoundError, match="No completed"):
        upload_cache.latest_upload_pair((root,))
