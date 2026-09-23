"""Tests for archive-wide structural-context cache orchestration."""

import json

import pytest

from proptm3d import alphafold_cache, structural_context, structural_context_cache
from proptm3d.uniprot_cache import Proteome


def _models():
    return {
        "P12345": [
            {
                "file": "AF-P12345-F1-model_v6.cif.gz",
                "model_id": "AF-P12345-F1",
                "fragment": 1,
                "version": 6,
                "start": 1,
                "end": 7,
                "pae_url": "https://example.org/pae.json",
            }
        ]
    }


def test_precompute_archive_context_writes_completion_manifest(tmp_path, monkeypatch):
    proteome = structural_context_cache.proteome_for_organism("MOUSE")
    models = _models()
    calls = []

    def archive_models(received, cache_root, session):
        calls.append(("archive", received.id))
        return models

    def pae_files(received, cache_root, session):
        calls.append(("pae", set(received)))
        yield models["P12345"][0]["file"], tmp_path / "pae.json.gz"

    def model_contexts(received, pae, cache_root):
        calls.append(("context", set(received)))
        path = structural_context.model_context_path(models["P12345"][0], cache_root)
        path.parent.mkdir(parents=True)
        path.touch()
        return {models["P12345"][0]["file"]: path}

    monkeypatch.setattr(structural_context_cache, "cache_archive_models", archive_models)
    monkeypatch.setattr(structural_context_cache, "iter_cached_pae_files", pae_files)
    monkeypatch.setattr(structural_context_cache, "cache_model_contexts", model_contexts)

    manifest = structural_context_cache.precompute_archive_context(proteome, tmp_path)

    marker = structural_context_cache.context_manifest_path(proteome, tmp_path)
    assert json.loads(marker.read_text()) == manifest
    assert manifest["models"] == 1
    assert manifest["accessions"] == 1
    assert [call[0] for call in calls] == ["archive", "pae", "context"]
    assert structural_context_cache.load_precomputed_contexts(proteome, models, tmp_path) == {
        models["P12345"][0]["file"]: structural_context.model_context_path(
            models["P12345"][0], tmp_path
        )
    }


def test_load_precomputed_contexts_requires_matching_complete_archive(tmp_path):
    proteome = structural_context_cache.proteome_for_organism("HUMAN")
    with pytest.raises(FileNotFoundError, match="cache context HUMAN"):
        structural_context_cache.load_precomputed_contexts(proteome, _models(), tmp_path)

    marker = structural_context_cache.context_manifest_path(proteome, tmp_path)
    marker.parent.mkdir(parents=True)
    marker.write_text(json.dumps({"kind": "wrong"}))
    with pytest.raises(ValueError, match="does not match"):
        structural_context_cache.load_precomputed_contexts(proteome, _models(), tmp_path)


def test_precompute_resume_skips_models_with_existing_context(tmp_path, monkeypatch):
    proteome = structural_context_cache.proteome_for_organism("MOUSE")
    models = _models()
    existing = structural_context.model_context_path(models["P12345"][0], tmp_path)
    existing.parent.mkdir(parents=True)
    existing.touch()
    received = []

    def pae_files(pending, cache_root, session):
        received.append(pending)
        yield from ()

    monkeypatch.setattr(structural_context_cache, "cache_archive_models", lambda *args: models)
    monkeypatch.setattr(structural_context_cache, "iter_cached_pae_files", pae_files)

    manifest = structural_context_cache.precompute_archive_context(proteome, tmp_path)

    assert received == [{}]
    assert manifest["models"] == 1


def test_load_precomputed_contexts_rejects_missing_archive_model_but_allows_foreign(
    tmp_path,
):
    proteome = structural_context_cache.proteome_for_organism("MOUSE")
    marker = structural_context_cache.context_manifest_path(proteome, tmp_path)
    marker.parent.mkdir(parents=True)
    marker.write_text(
        json.dumps(
            {
                "kind": structural_context_cache.MANIFEST_KIND,
                "proteome": proteome.id,
                "alphafold_archive": "UP000000589_10090_MOUSE_v6.tar",
                "alphafold_archive_version": "v6",
                "algorithm": {"algorithm_version": "bludau-v1"},
            }
        )
    )
    with pytest.raises(FileNotFoundError, match="missing archive models"):
        structural_context_cache.load_precomputed_contexts(proteome, _models(), tmp_path)

    foreign = _models()
    foreign["P12345"][0]["file"] = "AF-P12345-F1-individual.cif.gz"
    assert structural_context_cache.load_precomputed_contexts(proteome, foreign, tmp_path) == {}


def test_precompute_rejects_empty_archive_and_unknown_organism(tmp_path, monkeypatch):
    proteome = Proteome("UP0", 1, "1_TEST")
    monkeypatch.setattr(structural_context_cache, "cache_archive_models", lambda *args: {})
    with pytest.raises(ValueError, match="contains no mmCIF models"):
        structural_context_cache.precompute_archive_context(proteome, tmp_path)
    with pytest.raises(ValueError, match="Unsupported organism"):
        structural_context_cache.proteome_for_organism("YEAST")


def test_cache_statuses_report_available_partial_and_missing_caches(tmp_path):
    proteome = structural_context_cache.proteome_for_organism("MOUSE")
    model = _models()["P12345"][0]
    catalog = alphafold_cache.archive_catalog_path(tmp_path, proteome)
    catalog.parent.mkdir(parents=True)
    catalog.write_text(
        json.dumps(
            {
                "archive": alphafold_cache.archive_name(proteome),
                "models": [{"accession": "P12345", **model}],
            }
        )
    )
    structure = tmp_path / "alphafold" / "structures" / model["file"]
    structure.parent.mkdir()
    structure.touch()
    context = structural_context.model_context_path(model, tmp_path)
    context.parent.mkdir(parents=True)
    context.touch()
    manifest = structural_context_cache.context_manifest_path(proteome, tmp_path)
    manifest.write_text(
        json.dumps(
            {
                "kind": structural_context_cache.MANIFEST_KIND,
                "proteome": proteome.id,
                "alphafold_archive": alphafold_cache.archive_name(proteome),
                "alphafold_archive_version": alphafold_cache.ARCHIVE_VERSION,
                "algorithm": {"algorithm_version": structural_context.CONTEXT_ALGORITHM_VERSION},
                "models": 1,
            }
        )
    )

    mouse, human = structural_context_cache.cache_statuses(tmp_path)

    assert mouse["organism"] == "MOUSE"
    assert mouse["structures"] == {"cached": 1, "total": 1, "available": True}
    assert mouse["pae"] == {"cached": 0, "total": 1, "available": False}
    assert mouse["context"] == {
        "cached": 1,
        "total": 1,
        "available": True,
        "algorithm": "bludau-v1",
    }
    assert human["organism"] == "HUMAN"
    assert human["structures"] == {"cached": 0, "total": 0, "available": False}
    assert human["pae"] == {"cached": 0, "total": 0, "available": False}
    assert human["context"]["available"] is False
