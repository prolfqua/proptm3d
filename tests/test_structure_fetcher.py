"""Tests for AlphaFold structure fetching and caching (no real network access)."""

import pytest
import requests

from ptm3d import structure_fetcher
from ptm3d.structure_fetcher import StructureFetchError


class FakeResponse:
    def __init__(self, json_data=None, text="", status_ok=True):
        self._json_data = json_data
        self.text = text
        self._status_ok = status_ok

    def json(self):
        return self._json_data

    def raise_for_status(self):
        if not self._status_ok:
            raise requests.HTTPError("boom")


def test_fetch_structure_uses_cache_without_network(tmp_path, monkeypatch):
    cached = tmp_path / "P28482.pdb"
    cached.write_text("ATOM", encoding="utf-8")

    def fail(*_args, **_kwargs):
        raise AssertionError("network must not be touched on cache hit")

    monkeypatch.setattr(structure_fetcher.requests, "get", fail)

    assert structure_fetcher.fetch_structure("P28482", cache_dir=tmp_path) == cached


def test_fetch_structure_downloads_and_caches(tmp_path, monkeypatch):
    calls = []

    def fake_get(url, timeout):
        calls.append(url)
        if "api/prediction" in url:
            return FakeResponse(json_data=[{"pdbUrl": "https://example.org/P28482.pdb"}])
        return FakeResponse(text="ATOM      1  CA ...")

    monkeypatch.setattr(structure_fetcher.requests, "get", fake_get)

    path = structure_fetcher.fetch_structure("P28482-2", cache_dir=tmp_path)

    assert path == tmp_path / "P28482.pdb"  # Isoform suffix stripped.
    assert path.read_text(encoding="utf-8").startswith("ATOM")
    assert calls == [
        "https://alphafold.ebi.ac.uk/api/prediction/P28482",
        "https://example.org/P28482.pdb",
    ]


def test_fetch_structure_no_model(monkeypatch, tmp_path):
    monkeypatch.setattr(
        structure_fetcher.requests, "get", lambda url, timeout: FakeResponse(json_data=[])
    )
    with pytest.raises(StructureFetchError, match="no model"):
        structure_fetcher.fetch_structure("Q00000", cache_dir=tmp_path)


def test_fetch_structure_api_failure(monkeypatch, tmp_path):
    monkeypatch.setattr(
        structure_fetcher.requests, "get", lambda url, timeout: FakeResponse(status_ok=False)
    )
    with pytest.raises(StructureFetchError, match="request failed"):
        structure_fetcher.fetch_structure("Q00000", cache_dir=tmp_path)


def test_fetch_structure_missing_url_key(monkeypatch, tmp_path):
    monkeypatch.setattr(
        structure_fetcher.requests, "get", lambda url, timeout: FakeResponse(json_data=[{}])
    )
    with pytest.raises(StructureFetchError, match="No pdb URL"):
        structure_fetcher.fetch_structure("Q00000", cache_dir=tmp_path)
