"""Build atomic, method-scoped static data packages from PTM MuData."""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

import cbor2
import polars as pl

from proptm3d.alphafold_cache import ARCHIVE_VERSION, cache_models
from proptm3d.prepared_data import (
    METHOD_SPECS,
    SCHEMA_VERSION,
    PreparedTables,
    read_prepared_tables,
)
from proptm3d.uniprot_cache import AnnotationTables, load_annotations

MANIFEST_KIND = "proptm3d-prepared-method"
DEFAULT_INPUT = Path("PTM_statistics.h5mu")
DEFAULT_OUTPUT = Path("output_3d")


def _write_cbor(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as output:
        cbor2.dump(payload, output)


def _annotation_status(
    accession: str, sites: pl.DataFrame, sequence_by_accession: dict[str, str]
) -> str:
    sequence = sequence_by_accession.get(accession)
    if sequence is None:
        return "unmapped"
    for site in sites.iter_rows(named=True):
        position = site["posInProtein"]
        residue = site["modAA"]
        if position is None or residue not in {"S", "T", "Y"}:
            continue
        if position < 1 or position > len(sequence) or sequence[position - 1] != residue:
            return "sequence_mismatch"
    return "matched"


def _add_annotations(
    tables: PreparedTables, annotations: AnnotationTables
) -> tuple[pl.DataFrame, pl.DataFrame]:
    accessions = set(tables.proteins["accession"].to_list())
    annotated = annotations.proteins.filter(pl.col("accession").is_in(accessions))
    sequence_lookup = dict(
        zip(annotated["accession"].to_list(), annotated["sequence"].to_list(), strict=True)
    )
    sites_by_accession = tables.sites.partition_by("accession", as_dict=True)
    statuses = [
        {
            "accession": accession,
            "annotation_status": _annotation_status(
                accession, sites_by_accession[(accession,)], sequence_lookup
            ),
        }
        for accession in tables.proteins["accession"]
    ]
    proteins = tables.proteins.join(annotated.drop("sequence"), on="accession", how="left").join(
        pl.DataFrame(statuses), on="accession", how="left"
    )
    features = annotations.features.filter(pl.col("accession").is_in(accessions)).join(
        tables.proteins.select("protein_Id", "accession"), on="accession", how="inner"
    )
    return proteins, features


def _write_method(
    staging: Path,
    tables: PreparedTables,
    annotations: AnnotationTables,
    models: dict[str, list[dict]],
    cache_root: Path,
) -> dict:
    staging.mkdir()
    (staging / "tables").mkdir()
    (staging / "data").mkdir()
    proteins, features = _add_annotations(tables, annotations)
    tables.sites.write_parquet(staging / "tables" / "sites.parquet")
    tables.stats.write_parquet(staging / "tables" / "site_stats.parquet")
    tables.measurements.write_parquet(staging / "tables" / "measurements.parquet")
    proteins.write_parquet(staging / "tables" / "proteins.parquet")
    features.write_parquet(staging / "tables" / "protein_features.parquet")

    structures = cache_root / "alphafold" / "structures"
    (staging / "structures").symlink_to(structures.resolve(), target_is_directory=True)
    site_groups = tables.sites.partition_by("protein_Id", as_dict=True)
    result_groups = tables.stats.partition_by("protein_Id", as_dict=True)
    measurement_groups = tables.measurements.partition_by("protein_Id", as_dict=True)
    feature_groups = features.partition_by("accession", as_dict=True)
    protein_rows = []
    for protein in proteins.iter_rows(named=True):
        accession = protein["accession"]
        protein_id = protein["protein_Id"]
        site_rows = site_groups[(protein_id,)]
        result_rows = result_groups.get((protein_id,), tables.stats.clear())
        measurement_rows = measurement_groups[(protein_id,)]
        feature_rows = feature_groups.get((accession,), features.clear())
        structure_rows = [
            {**model, "url": f"structures/{model['file']}"} for model in models.get(accession, [])
        ]
        _write_cbor(
            staging / "data" / "proteins" / f"{accession}.cbor",
            {
                "protein": protein,
                "sites": site_rows.to_dicts(),
                "results": result_rows.to_dicts(),
                "structures": structure_rows,
            },
        )
        _write_cbor(
            staging / "data" / "evidence" / f"{accession}.cbor",
            {
                "samples": tables.samples,
                "measurements": measurement_rows.to_dicts(),
            },
        )
        _write_cbor(
            staging / "data" / "features" / f"{accession}.cbor",
            {
                "status": protein["annotation_status"],
                "features": feature_rows.to_dicts(),
            },
        )
        protein_rows.append(
            {
                **protein,
                "protein_file": f"data/proteins/{accession}.cbor",
                "evidence_file": f"data/evidence/{accession}.cbor",
                "features_file": f"data/features/{accession}.cbor",
                "structure_count": len(structure_rows),
            }
        )
    _write_cbor(staging / "data" / "proteins.cbor", protein_rows)
    site_index = tables.stats.join(
        tables.sites.select("protein_Id", "site", "accession", "has_measurement"),
        on=["protein_Id", "site"],
        how="left",
    )
    _write_cbor(staging / "data" / "site_index.cbor", site_index.to_dicts())
    counts = {
        "proteins": proteins.height,
        "measured_sites": tables.sites.filter(pl.col("has_measurement")).height,
        "result_rows": tables.stats.height,
        "annotation_matched": proteins.filter(pl.col("annotation_status") == "matched").height,
        "annotation_missing": proteins.filter(pl.col("annotation_status") == "unmapped").height,
        "annotation_mismatch": proteins.filter(
            pl.col("annotation_status") == "sequence_mismatch"
        ).height,
        "without_features": proteins.filter(pl.col("annotation_status") == "matched")
        .join(features.select("accession").unique(), on="accession", how="anti")
        .height,
        "with_structures": sum(bool(models.get(acc)) for acc in proteins["accession"]),
    }
    manifest = {
        "kind": MANIFEST_KIND,
        "schema_version": SCHEMA_VERSION,
        "method": tables.method,
        "contrasts": tables.contrasts,
        "samples": tables.samples,
        "sample_name_field": "Name",
        "sample_condition_field": "G_",
        "proteome": annotations.proteome.id,
        "taxon_id": annotations.proteome.taxon_id,
        "uniprot_release": annotations.release,
        "alphafold_archive_version": ARCHIVE_VERSION,
        "counts": counts,
        "files": {
            "proteins": "data/proteins.cbor",
            "site_index": "data/site_index.cbor",
            "site_stats_parquet": "tables/site_stats.parquet",
            "measurements_parquet": "tables/measurements.parquet",
            "protein_features_parquet": "tables/protein_features.parquet",
        },
    }
    (staging / "data" / "run.json").write_text(json.dumps(manifest, indent=2))
    (staging / "index.html").write_text(
        "<!doctype html><html lang='en'><meta charset='utf-8'>"
        f"<title>proptm3d {tables.method}</title><h1>proptm3d {tables.method}</h1>"
        "<p>Prepared data is available. "
        "The interactive browser view is the next development step.</p>"
        "<p><a href='data/run.json'>Run manifest</a></p></html>"
    )
    return manifest


def _replace_directory(staging: Path, target: Path) -> None:
    backup = target.with_name(f".{target.name}.previous")
    if backup.exists():
        shutil.rmtree(backup)
    if target.exists():
        if not is_prepared(target):
            msg = f"Refusing to overwrite an unrecognized directory: {target}"
            raise ValueError(msg)
        target.replace(backup)
    try:
        staging.replace(target)
    except Exception:
        if backup.exists():
            backup.replace(target)
        raise
    if backup.exists():
        shutil.rmtree(backup)


def prepare_methods(
    input_file: Path = DEFAULT_INPUT,
    output_dir: Path = DEFAULT_OUTPUT,
    methods: tuple[str, ...] = tuple(METHOD_SPECS),
    cache_root: Path | None = None,
) -> list[dict]:
    """Prepare requested methods, sharing one annotation and structure acquisition."""
    if not input_file.is_file():
        raise FileNotFoundError(input_file)
    output_dir.mkdir(parents=True, exist_ok=True)
    cache_root = cache_root or Path.home() / ".cache" / "proptm3d"
    tables = [read_prepared_tables(input_file, method) for method in methods]
    fasta_ids = list({fasta for item in tables for fasta in item.sites["fasta.id"]})
    accessions = {accession for item in tables for accession in item.proteins["accession"]}
    isoforms = sorted(accession for accession in accessions if "-" in accession)
    if isoforms:
        msg = f"Isoform coordinates need explicit mapping before preparation: {isoforms[:5]}"
        raise ValueError(msg)
    annotations = load_annotations(fasta_ids, accessions, cache_root)
    models = cache_models(
        annotations.proteome, accessions, annotations.primary_accessions, cache_root
    )
    manifests = []
    for item in tables:
        with tempfile.TemporaryDirectory(prefix=f".{item.method}-", dir=output_dir) as temporary:
            staging = Path(temporary) / item.method
            manifest = _write_method(staging, item, annotations, models, cache_root)
            _replace_directory(staging, output_dir / item.method)
            manifests.append(manifest)
    return manifests


def is_prepared(directory: Path, method: str | None = None) -> bool:
    """Check a method-owned manifest before serving, replacing, or cleaning."""
    manifest = directory / "data" / "run.json"
    if not manifest.is_file():
        return False
    data = json.loads(manifest.read_text())
    return data.get("kind") == MANIFEST_KIND and (method is None or data.get("method") == method)


def clean_methods(
    output_dir: Path = DEFAULT_OUTPUT, methods: tuple[str, ...] = tuple(METHOD_SPECS)
) -> list[Path]:
    """Remove only method directories carrying our preparation manifest."""
    removed = []
    for method in methods:
        target = output_dir / method
        if not target.exists():
            continue
        if not is_prepared(target, method):
            msg = f"Refusing to clean an unrecognized directory: {target}"
            raise ValueError(msg)
        shutil.rmtree(target)
        removed.append(target)
    return removed
