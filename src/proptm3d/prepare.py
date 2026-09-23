"""Build atomic, method-scoped static data packages from PTM MuData."""

from __future__ import annotations

import json
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import quote
from zipfile import ZipFile

import polars as pl

from proptm3d.alphafold_cache import ARCHIVE_VERSION, cache_models
from proptm3d.gsea_data import GseaTables, archive_gsea_members, read_gsea_tables
from proptm3d.prepared_data import (
    METHOD_SPECS,
    SCHEMA_VERSION,
    PreparedTables,
    read_prepared_tables,
)
from proptm3d.structural_context import (
    CONTEXT_METADATA,
    site_structural_context,
)
from proptm3d.structural_context_cache import load_precomputed_contexts
from proptm3d.uniprot_cache import AnnotationTables, load_annotations

MANIFEST_KIND = "proptm3d-prepared-method"
DEFAULT_INPUT = Path("PTM_statistics.h5mu")
DEFAULT_OUTPUT = Path("output_3d")


@contextmanager
def _statistics_source(input_file: Path, output_dir: Path) -> Iterator[Path]:
    if input_file.suffix.lower() != ".zip":
        yield input_file
        return

    with ZipFile(input_file) as archive:
        members = [
            item
            for item in archive.infolist()
            if not item.is_dir() and Path(item.filename).name == "PTM_statistics.h5mu"
        ]
        if len(members) != 1:
            msg = f"Expected exactly one PTM_statistics.h5mu in {input_file}; found {len(members)}"
            raise ValueError(msg)
        with tempfile.TemporaryDirectory(prefix=".statistics-", dir=output_dir) as temporary:
            statistics_file = Path(temporary) / "PTM_statistics.h5mu"
            with archive.open(members[0]) as source, statistics_file.open("wb") as target:
                shutil.copyfileobj(source, target)
            yield statistics_file


@contextmanager
def _gsea_source(
    input_file: Path,
    output_dir: Path,
    methods: tuple[str, ...],
) -> Iterator[tuple[Path, dict[str, GseaTables]]]:
    if input_file.suffix.lower() != ".zip":
        msg = "GSEA preparation requires a completed PTM delivery ZIP"
        raise ValueError(msg)
    with ZipFile(input_file) as archive:
        result_members = [
            item
            for item in archive.infolist()
            if not item.is_dir() and Path(item.filename).name == "PTM_results.h5mu"
        ]
        if len(result_members) != 1:
            msg = (
                f"Expected exactly one PTM_results.h5mu in {input_file}; "
                f"found {len(result_members)}"
            )
            raise ValueError(msg)
        members_by_method = {method: archive_gsea_members(archive, method) for method in methods}
        missing = [method for method, members in members_by_method.items() if not members]
        if missing:
            msg = f"Delivery ZIP has no GSEA results for: {', '.join(missing)}"
            raise ValueError(msg)
        with tempfile.TemporaryDirectory(prefix=".results-", dir=output_dir) as temporary:
            results_file = Path(temporary) / "PTM_results.h5mu"
            with archive.open(result_members[0]) as source, results_file.open("wb") as target:
                shutil.copyfileobj(source, target)
            gsea = {
                method: read_gsea_tables(archive, members_by_method[method], method)
                for method in methods
            }
            yield results_file, gsea


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
    proteins = proteins.with_columns(
        pl.Series(
            "uniprot_url",
            [
                f"https://www.uniprot.org/uniprotkb/{quote(accession, safe='')}"
                for accession in proteins["accession"]
            ],
            dtype=pl.String,
        ),
        pl.Series(
            "string_url",
            [
                f"https://string-db.org/cgi/network?identifiers={quote(accession, safe='')}"
                f"&species={taxon_id}"
                if taxon_id is not None
                else None
                for accession, taxon_id in zip(
                    proteins["accession"], proteins["taxon_id"], strict=True
                )
            ],
            dtype=pl.String,
        ),
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
    context_files: dict[str, Path],
    preparation: str,
    gsea: GseaTables | None = None,
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
    structure_rows = [
        {
            "protein_Id": protein["protein_Id"],
            "accession": protein["accession"],
            "file": model["file"],
            "fragment": model["fragment"],
            "version": model["version"],
            "start": model["start"],
            "end": model["end"],
            "url": f"structures/{model['file']}",
        }
        for protein in proteins.iter_rows(named=True)
        for model in models.get(protein["accession"], [])
    ]
    structures_table = pl.DataFrame(
        structure_rows,
        schema={
            "protein_Id": proteins.schema["protein_Id"],
            "accession": proteins.schema["accession"],
            "file": pl.String,
            "fragment": pl.Int64,
            "version": pl.Int64,
            "start": pl.Int64,
            "end": pl.Int64,
            "url": pl.String,
        },
    )
    structures_table.write_parquet(staging / "tables" / "structures.parquet")
    structural_context = site_structural_context(tables.sites, context_files)
    structural_context.write_parquet(staging / "tables" / "site_structural_context.parquet")
    if gsea is not None:
        gsea.terms.write_parquet(staging / "tables" / "gsea_terms.parquet")

    structures = cache_root / "alphafold" / "structures"
    (staging / "structures").symlink_to(structures.resolve(), target_is_directory=True)
    complete_result_sites = (
        tables.stats.filter(pl.col("effect").is_finite() & pl.col("fdr").is_finite())
        .select("protein_Id", "site")
        .unique()
    )
    result_proteins = set(complete_result_sites["protein_Id"].to_list())
    context_matched_sites = (
        structural_context.filter(pl.col("mapping_status") == "matched")
        .select("protein_Id", "site")
        .unique()
        .height
    )
    counts = {
        "proteins": proteins.height,
        "measured_sites": tables.sites.filter(pl.col("has_measurement")).height,
        "result_rows": tables.stats.height,
        "complete_result_sites": complete_result_sites.height,
        "complete_result_proteins": len(result_proteins),
        "complete_result_structures": structures_table.filter(
            pl.col("protein_Id").is_in(result_proteins)
        )["protein_Id"].n_unique(),
        "measured_sites_without_result": tables.sites.filter(pl.col("has_measurement"))
        .join(complete_result_sites, on=["protein_Id", "site"], how="anti")
        .height,
        "annotation_matched": proteins.filter(pl.col("annotation_status") == "matched").height,
        "annotation_missing": proteins.filter(pl.col("annotation_status") == "unmapped").height,
        "annotation_mismatch": proteins.filter(
            pl.col("annotation_status") == "sequence_mismatch"
        ).height,
        "without_features": proteins.filter(pl.col("annotation_status") == "matched")
        .join(features.select("accession").unique(), on="accession", how="anti")
        .height,
        "with_structures": structures_table["protein_Id"].n_unique(),
        "structural_context_models": len(context_files),
        "structural_context_matched_sites": context_matched_sites,
        "structural_context_unavailable_sites": structural_context.filter(
            pl.col("mapping_status") == "unavailable"
        ).height,
    }
    files = {
        "proteins_parquet": "tables/proteins.parquet",
        "sites_parquet": "tables/sites.parquet",
        "site_stats_parquet": "tables/site_stats.parquet",
        "measurements_parquet": "tables/measurements.parquet",
        "protein_features_parquet": "tables/protein_features.parquet",
        "structures_parquet": "tables/structures.parquet",
        "site_structural_context_parquet": "tables/site_structural_context.parquet",
    }
    if gsea is not None:
        files["gsea_terms_parquet"] = "tables/gsea_terms.parquet"
        counts["gsea_terms"] = gsea.terms.height
        counts["gsea_sources"] = gsea.terms["source"].n_unique()
    manifest = {
        "kind": MANIFEST_KIND,
        "schema_version": SCHEMA_VERSION,
        "preparation": preparation,
        "method": tables.method,
        "contrasts": tables.contrasts,
        "samples": tables.samples,
        "sample_name_field": "Name",
        "sample_condition_field": "G_",
        "proteome": annotations.proteome.id,
        "taxon_id": annotations.proteome.taxon_id,
        "uniprot_release": annotations.release,
        "alphafold_archive_version": ARCHIVE_VERSION,
        "structural_context": CONTEXT_METADATA,
        "counts": counts,
        "files": files,
    }
    if gsea is not None:
        manifest["gsea"] = {
            "sources": sorted(gsea.terms["source"].unique().to_list()),
            "documents": gsea.documents,
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


def _prepare_from_mudata(
    mudata_file: Path,
    expected_stage: str,
    preparation: str,
    gsea: dict[str, GseaTables],
    output_dir: Path = DEFAULT_OUTPUT,
    methods: tuple[str, ...] = tuple(METHOD_SPECS),
    cache_root: Path | None = None,
) -> list[dict]:
    """Prepare requested methods from one validated MuData source."""
    cache_root = cache_root or Path.home() / ".cache" / "proptm3d"
    tables = [
        read_prepared_tables(mudata_file, method, expected_stage=expected_stage)
        for method in methods
    ]
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
    context_files = load_precomputed_contexts(annotations.proteome, models, cache_root)
    manifests = []
    for item in tables:
        with tempfile.TemporaryDirectory(prefix=f".{item.method}-", dir=output_dir) as temporary:
            staging = Path(temporary) / item.method
            manifest = _write_method(
                staging,
                item,
                annotations,
                models,
                cache_root,
                context_files,
                preparation,
                gsea.get(item.method),
            )
            _replace_directory(staging, output_dir / item.method)
            manifests.append(manifest)
    return manifests


def prepare_stats(
    input_file: Path = DEFAULT_INPUT,
    output_dir: Path = DEFAULT_OUTPUT,
    methods: tuple[str, ...] = tuple(METHOD_SPECS),
    cache_root: Path | None = None,
) -> list[dict]:
    """Prepare quantification and DEA Parquet tables from the statistics stage."""
    if not input_file.is_file():
        raise FileNotFoundError(input_file)
    output_dir.mkdir(parents=True, exist_ok=True)
    with _statistics_source(input_file, output_dir) as statistics_file:
        return _prepare_from_mudata(
            statistics_file,
            "PTM_statistics",
            "stats",
            {},
            output_dir,
            methods,
            cache_root,
        )


def prepare_gsea(
    input_file: Path,
    output_dir: Path = DEFAULT_OUTPUT,
    methods: tuple[str, ...] = tuple(METHOD_SPECS),
    cache_root: Path | None = None,
) -> list[dict]:
    """Prepare stats and required GSEA Parquet tables from a completed delivery ZIP."""
    if not input_file.is_file():
        raise FileNotFoundError(input_file)
    output_dir.mkdir(parents=True, exist_ok=True)
    with _gsea_source(input_file, output_dir, methods) as (results_file, gsea):
        return _prepare_from_mudata(
            results_file,
            "PTM_results",
            "gsea",
            gsea,
            output_dir,
            methods,
            cache_root,
        )


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
