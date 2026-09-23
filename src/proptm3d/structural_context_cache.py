"""Archive-wide AlphaFold structural-context cache orchestration."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import requests
from loguru import logger

from proptm3d.alphafold_cache import (
    ARCHIVE_VERSION,
    archive_catalog_path,
    archive_name,
    cache_archive_models,
    iter_cached_pae_files,
)
from proptm3d.structural_context import (
    CONTEXT_ALGORITHM_VERSION,
    CONTEXT_METADATA,
    cache_model_contexts,
    model_context_path,
)
from proptm3d.uniprot_cache import PROTEOMES, Proteome

MANIFEST_KIND = "proptm3d-structural-context-cache"
DEFAULT_CACHE_ROOT = Path.home() / ".cache" / "proptm3d"


def proteome_for_organism(organism: str) -> Proteome:
    """Resolve one supported organism name to its reference proteome."""
    try:
        proteome_id, taxon_id, archive_suffix = PROTEOMES[organism]
    except KeyError as error:
        choices = ", ".join(PROTEOMES)
        msg = f"Unsupported organism {organism!r}; choose {choices}"
        raise ValueError(msg) from error
    return Proteome(proteome_id, taxon_id, archive_suffix)


def _organism_for_proteome(proteome: Proteome) -> str:
    for organism, (proteome_id, _taxon_id, _suffix) in PROTEOMES.items():
        if proteome.id == proteome_id:
            return organism
    return proteome.id


def context_manifest_path(proteome: Proteome, cache_root: Path) -> Path:
    """Return the completion-manifest path for an archive-wide context cache."""
    archive_stem = archive_name(proteome).removesuffix(".tar")
    return (
        cache_root
        / "alphafold"
        / "structural_context"
        / CONTEXT_ALGORITHM_VERSION
        / f"{archive_stem}.complete.json"
    )


def _file_names(directory: Path, suffix: str) -> set[str]:
    if not directory.is_dir():
        return set()
    return {
        path.name for path in directory.iterdir() if path.is_file() and path.name.endswith(suffix)
    }


def cache_statuses(cache_root: Path) -> list[dict]:
    """Report local structure, PAE, and context availability for supported proteomes."""
    alphafold_root = cache_root / "alphafold"
    structure_files = _file_names(alphafold_root / "structures", ".cif.gz")
    pae_files = _file_names(alphafold_root / "pae", ".json.gz")
    context_files = _file_names(
        alphafold_root / "structural_context" / CONTEXT_ALGORITHM_VERSION,
        ".parquet",
    )
    statuses = []
    for organism in PROTEOMES:
        proteome = proteome_for_organism(organism)
        catalog_path = archive_catalog_path(cache_root, proteome)
        models = []
        if catalog_path.is_file():
            catalog = json.loads(catalog_path.read_text())
            if catalog.get("archive") != archive_name(proteome):
                msg = f"AlphaFold cache catalog does not match {archive_name(proteome)}"
                raise ValueError(msg)
            models = catalog["models"]

        expected_structures = {model["file"] for model in models}
        expected_pae = {
            f"{model['model_id']}-predicted_aligned_error_v{model['version']}.json.gz"
            for model in models
        }
        expected_context = {
            f"{model['model_id']}-model_v{model['version']}.parquet" for model in models
        }
        total = len(models)
        structure_count = len(expected_structures & structure_files)
        pae_count = len(expected_pae & pae_files)
        context_count = len(expected_context & context_files)

        manifest_path = context_manifest_path(proteome, cache_root)
        context_complete = False
        if manifest_path.is_file():
            manifest = json.loads(manifest_path.read_text())
            context_complete = (
                manifest.get("kind") == MANIFEST_KIND
                and manifest.get("proteome") == proteome.id
                and manifest.get("alphafold_archive") == archive_name(proteome)
                and manifest.get("alphafold_archive_version") == ARCHIVE_VERSION
                and manifest.get("algorithm", {}).get("algorithm_version")
                == CONTEXT_ALGORITHM_VERSION
                and manifest.get("models") == total
                and context_count == total
                and total > 0
            )

        statuses.append(
            {
                "organism": organism,
                "proteome": proteome.id,
                "structures": {
                    "cached": structure_count,
                    "total": total,
                    "available": total > 0 and structure_count == total,
                },
                "pae": {
                    "cached": pae_count,
                    "total": total,
                    "available": total > 0 and pae_count == total,
                },
                "context": {
                    "cached": context_count,
                    "total": total,
                    "available": context_complete,
                    "algorithm": CONTEXT_ALGORITHM_VERSION,
                },
            }
        )
    return statuses


def precompute_archive_context(
    proteome: Proteome,
    cache_root: Path,
    session: requests.Session | None = None,
) -> dict:
    """Compute reusable residue annotations for every model in a proteome archive."""
    models = cache_archive_models(proteome, cache_root, session)
    model_count = sum(len(entries) for entries in models.values())
    if model_count == 0:
        msg = f"AlphaFold archive {archive_name(proteome)} contains no mmCIF models"
        raise ValueError(msg)
    context_files = {}
    pending_models: dict[str, list[dict]] = {}
    models_by_file = {}
    for accession, entries in models.items():
        for model in entries:
            target = model_context_path(model, cache_root)
            if target.is_file():
                context_files[model["file"]] = target
            else:
                pending_models.setdefault(accession, []).append(model)
                models_by_file[model["file"]] = (accession, model)

    pending_count = sum(len(entries) for entries in pending_models.values())
    completed_count = len(context_files)
    logger.info(
        "Structural context cache: {} present, {} to compute",
        completed_count,
        pending_count,
    )
    for model_file, pae_file in iter_cached_pae_files(pending_models, cache_root, session):
        accession, model = models_by_file[model_file]
        context_files.update(
            cache_model_contexts(
                {accession: [model]},
                {model_file: pae_file},
                cache_root,
            )
        )
        completed_count += 1
        if completed_count % 250 == 0 or completed_count == model_count:
            logger.info(
                "Structural context cache: {} of {} models ready",
                completed_count,
                model_count,
            )
    missing = [path for path in context_files.values() if not path.is_file()]
    if len(context_files) != model_count or missing:
        msg = (
            f"Structural context cache is incomplete: {len(context_files) - len(missing)} "
            f"of {model_count} models"
        )
        raise RuntimeError(msg)
    manifest = {
        "kind": MANIFEST_KIND,
        "proteome": proteome.id,
        "taxon_id": proteome.taxon_id,
        "alphafold_archive": archive_name(proteome),
        "alphafold_archive_version": ARCHIVE_VERSION,
        "algorithm": CONTEXT_METADATA,
        "accessions": sum(bool(entries) for entries in models.values()),
        "models": model_count,
    }
    target = context_manifest_path(proteome, cache_root)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=target.parent, delete=False) as temporary:
        staged = Path(temporary.name)
        json.dump(manifest, temporary, indent=2)
    staged.replace(target)
    return manifest


def load_precomputed_contexts(
    proteome: Proteome,
    models: dict[str, list[dict]],
    cache_root: Path,
) -> dict[str, Path]:
    """Load selected model contexts after verifying archive-wide precomputation."""
    manifest_path = context_manifest_path(proteome, cache_root)
    command = f"proptm3d cache context {_organism_for_proteome(proteome)}"
    if not manifest_path.is_file():
        msg = (
            f"Structural context has not been precomputed for {archive_name(proteome)}; "
            f"run '{command}' first"
        )
        raise FileNotFoundError(msg)
    manifest = json.loads(manifest_path.read_text())
    expected = {
        "kind": MANIFEST_KIND,
        "proteome": proteome.id,
        "alphafold_archive": archive_name(proteome),
        "alphafold_archive_version": ARCHIVE_VERSION,
    }
    if any(manifest.get(key) != value for key, value in expected.items()) or (
        manifest.get("algorithm", {}).get("algorithm_version") != CONTEXT_ALGORITHM_VERSION
    ):
        msg = f"Structural context cache does not match {archive_name(proteome)}; rerun '{command}'"
        raise ValueError(msg)

    cached = {}
    missing_archive_models = []
    for accession in sorted(models):
        for model in sorted(models[accession], key=lambda item: item["fragment"]):
            path = model_context_path(model, cache_root)
            if path.is_file():
                cached[model["file"]] = path
            elif model["file"].endswith(f"-model_v{model['version']}.cif.gz"):
                missing_archive_models.append(model["model_id"])
    if missing_archive_models:
        examples = ", ".join(missing_archive_models[:3])
        msg = f"Structural context cache is missing archive models ({examples}); rerun '{command}'"
        raise FileNotFoundError(msg)
    return cached
