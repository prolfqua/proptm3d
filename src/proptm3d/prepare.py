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

import h5py
import polars as pl

from proptm3d import browser_assets, prepared_root
from proptm3d.alphafold_cache import ARCHIVE_VERSION, cache_models, cached_pae_file
from proptm3d.gsea_data import (
    RESULT_LABELS,
    GseaArtifact,
    GseaInput,
    archive_gsea_artifacts,
    artifact_key,
    folder_gsea_artifacts,
    iter_gsea_tables,
)
from proptm3d.plot_backgrounds import write_plot_backgrounds
from proptm3d.prepared_data import (
    METHOD_SPECS,
    SCHEMA_VERSION,
    PreparedTables,
    read_prepared_tables,
)
from proptm3d.prepared_root import MANIFEST_KIND
from proptm3d.structural_context import (
    CONTEXT_METADATA,
    site_structural_context,
)
from proptm3d.structural_context_cache import DEFAULT_CACHE_ROOT, load_precomputed_contexts
from proptm3d.uniprot_cache import AnnotationTables, load_annotations


@contextmanager
def _statistics_source(input_file: Path, output_dir: Path) -> Iterator[tuple[Path, str]]:
    if input_file.is_dir():
        for name, stage in (
            ("PTM_results.h5mu", "PTM_results"),
            ("PTM_statistics.h5mu", "PTM_statistics"),
        ):
            candidate = input_file / name
            if candidate.is_file():
                yield candidate, stage
                return
        msg = f"Expected PTM_results.h5mu or PTM_statistics.h5mu in {input_file}"
        raise ValueError(msg)
    if input_file.suffix.lower() != ".zip":
        with h5py.File(input_file) as handle:
            stage = handle["uns/prophosqua/stage"].asstr()[()]
        if stage not in {"PTM_statistics", "PTM_results"}:
            msg = f"Expected a statistics-bearing PTM MuData stage, found {stage}"
            raise ValueError(msg)
        yield input_file, stage
        return

    stages = {"PTM_statistics.h5mu": "PTM_statistics", "PTM_results.h5mu": "PTM_results"}
    with ZipFile(input_file) as archive:
        members_by_name = {
            Path(item.filename).name: item
            for item in archive.infolist()
            if not item.is_dir() and Path(item.filename).name in stages
        }
        member = members_by_name.get("PTM_results.h5mu") or members_by_name.get(
            "PTM_statistics.h5mu"
        )
        if member is None:
            msg = f"Expected PTM_statistics.h5mu or PTM_results.h5mu in {input_file}; found 0"
            raise ValueError(msg)
        with tempfile.TemporaryDirectory(prefix=".statistics-", dir=output_dir) as temporary:
            name = Path(member.filename).name
            statistics_file = Path(temporary) / name
            with archive.open(member) as source, statistics_file.open("wb") as target:
                shutil.copyfileobj(source, target)
            yield statistics_file, stages[name]


def _gsea_checksums(
    results_file: Path,
    artifacts_by_method: dict[str, list[GseaArtifact]],
) -> dict[str, str]:
    expected = {}
    with h5py.File(results_file) as handle:
        namespace = handle["uns/prophosqua"]
        recorded_files = namespace["enrichment_files"]
        recorded_checksums = namespace["enrichment_sha256"]
        for method, artifacts in artifacts_by_method.items():
            for artifact in artifacts:
                key = artifact_key(method, artifact)
                relative = recorded_files[key].asstr()[()]
                if artifact.filename != relative and not artifact.filename.endswith(f"/{relative}"):
                    msg = f"GSEA artifact path does not match PTM_results.h5mu: {artifact.filename}"
                    raise ValueError(msg)
                expected[artifact.filename] = recorded_checksums[key].asstr()[()]
    return expected


@contextmanager
def _gsea_source(
    input_file: Path,
    output_dir: Path,
    methods: tuple[str, ...],
) -> Iterator[tuple[Path, dict[str, GseaInput]]]:
    if input_file.is_dir():
        results_file = input_file / "PTM_results.h5mu"
        if not results_file.is_file():
            msg = f"Expected PTM_results.h5mu in {input_file}"
            raise ValueError(msg)
        artifacts_by_method = {
            method: folder_gsea_artifacts(input_file, method) for method in methods
        }
        missing = [method for method, artifacts in artifacts_by_method.items() if not artifacts]
        if missing:
            msg = f"Delivery folder has no GSEA results for: {', '.join(missing)}"
            raise ValueError(msg)
        expected_checksums = _gsea_checksums(results_file, artifacts_by_method)
        yield (
            results_file,
            {
                method: GseaInput(artifacts_by_method[method], expected_checksums)
                for method in methods
            },
        )
        return
    if input_file.suffix.lower() != ".zip":
        msg = "GSEA preparation requires a completed PTM delivery ZIP or unpacked folder"
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
        artifacts_by_method = {
            method: archive_gsea_artifacts(archive, method) for method in methods
        }
        missing = [method for method, artifacts in artifacts_by_method.items() if not artifacts]
        if missing:
            msg = f"Delivery ZIP has no GSEA results for: {', '.join(missing)}"
            raise ValueError(msg)
        with tempfile.TemporaryDirectory(prefix=".results-", dir=output_dir) as temporary:
            results_file = Path(temporary) / "PTM_results.h5mu"
            with archive.open(result_members[0]) as source, results_file.open("wb") as target:
                shutil.copyfileobj(source, target)
            expected_checksums = _gsea_checksums(results_file, artifacts_by_method)
            gsea = {
                method: GseaInput(artifacts_by_method[method], expected_checksums)
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


def _pae_url(model: dict, cache_root: Path) -> str | None:
    cached = cached_pae_file(model, cache_root)
    return None if cached is None else f"pae/{cached.name}"


def _link_pae_files(staging: Path, pae_urls: list[str], cache_root: Path) -> None:
    """Expose only the experiment's cached PAE matrices, one symlink per model."""
    pae_cache = (cache_root / "alphafold" / "pae").resolve()
    (staging / "pae").mkdir()
    for url in pae_urls:
        name = Path(url).name
        (staging / "pae" / name).symlink_to(pae_cache / name)


def _link_residue_contexts(
    staging: Path, context_urls: list[str], context_files: dict[str, Path]
) -> None:
    """Expose selected model contexts without copying the entire proteome cache."""
    directory = staging / "residue_context"
    directory.mkdir()
    by_name = {path.name: path for path in context_files.values()}
    for url in set(context_urls):
        path = by_name[Path(url).name]
        (directory / path.name).symlink_to(path.resolve())


def _gsea_memberships(
    terms: pl.DataFrame, curves: pl.DataFrame, ranks: pl.DataFrame, sites: pl.DataFrame
) -> pl.DataFrame:
    keys = ["analysis", "contrast", "source", "result_stage", "term_id"]
    hit_counts = terms.select(*keys, pl.col("gene_ids").list.len().alias("member_count")).join(
        curves.select(*keys, pl.col("hit_indices").list.len().alias("hit_count")),
        on=keys,
        how="left",
        validate="1:1",
    )
    if hit_counts.filter(
        pl.col("hit_count").is_null() | (pl.col("member_count") != pl.col("hit_count"))
    ).height:
        msg = "GSEA sequence-set members do not align with running-curve hit indices"
        raise ValueError(msg)
    members = (
        terms.select(*keys, "gene_ids")
        .explode("gene_ids", empty_as_null=True)
        .rename({"gene_ids": "sequence_window"})
        .filter(pl.col("sequence_window").is_not_null())
        .with_columns(pl.col("sequence_window").str.to_uppercase())
    )
    hits = curves.select(
        *keys,
        pl.col("hit_indices").alias("rank"),
        pl.col("hit_scores").alias("running_score"),
    ).explode("rank", "running_score", empty_as_null=True)
    ranked = members.join(
        ranks,
        on=["analysis", "contrast", "result_stage", "sequence_window"],
        how="left",
        validate="m:1",
    ).join(hits, on=[*keys, "rank"], how="left", validate="1:1")
    if ranked.filter(pl.col("rank").is_null() | pl.col("running_score").is_null()).height:
        msg = "GSEA sequence-window gene_pool ranks do not match running-curve hits"
        raise ValueError(msg)
    leading = (
        terms.select(*keys, "leading_edge_ids")
        .explode("leading_edge_ids", empty_as_null=True)
        .rename({"leading_edge_ids": "sequence_window"})
        .filter(pl.col("sequence_window").is_not_null())
        .with_columns(
            pl.col("sequence_window").str.to_uppercase(),
            pl.lit(True).alias("is_leading_edge"),
        )
    )
    site_windows = (
        sites.select(
            "protein_Id",
            "site",
            pl.col("SequenceWindow").str.to_uppercase().alias("sequence_window"),
        )
        .filter(pl.col("sequence_window").is_not_null())
        .unique()
    )
    return (
        ranked.join(leading, on=[*keys, "sequence_window"], how="left")
        .with_columns(pl.col("is_leading_edge").fill_null(False))
        .join(site_windows, on="sequence_window", how="inner")
        .rename({"term_id": "sequence_set"})
        .select(
            "contrast",
            "result_stage",
            "source",
            "sequence_set",
            "protein_Id",
            "site",
            "sequence_window",
            "rank",
            "running_score",
            "is_leading_edge",
        )
        .unique()
        .sort("source", "sequence_set", "rank", "protein_Id", "site")
    )


def _write_gsea_tables(
    staging: Path,
    gsea: GseaInput,
    method: str,
    sites: pl.DataFrame,
    contrast_order: list[str],
) -> tuple[dict, dict]:
    root = staging / "tables" / "gsea"
    root.mkdir()
    contrast_index = {contrast: index for index, contrast in enumerate(contrast_order)}
    files_by_stage: dict[str, dict] = {}
    sources_by_stage: dict[str, set[str]] = {}
    all_sources: set[str] = set()
    term_count = 0
    membership_count = 0
    for chunk in iter_gsea_tables(gsea, method):
        if chunk.terms.is_empty():
            continue
        [stage] = chunk.terms["result_stage"].unique().to_list()
        [contrast] = chunk.terms["contrast"].unique().to_list()
        if contrast not in contrast_index:
            msg = f"GSEA contrast has no matching statistics: {contrast}"
            raise ValueError(msg)
        memberships = _gsea_memberships(chunk.terms, chunk.curves, chunk.ranks, sites)
        directory = root / stage / f"contrast-{contrast_index[contrast]}"
        directory.mkdir(parents=True)
        sequence_sets = chunk.terms.drop("gene_ids", "leading_edge_ids").rename(
            {"term_id": "sequence_set", "enrichment_score": "nes"}
        )
        memberships = memberships.drop("result_stage", "contrast")
        curves = chunk.curves.drop("analysis", "contrast", "result_stage").rename(
            {"term_id": "sequence_set"}
        )
        sequence_sets.write_parquet(directory / "sequence_sets.parquet")
        memberships.write_parquet(directory / "memberships.parquet")
        curves.write_parquet(directory / "curves.parquet")
        relative = directory.relative_to(staging).as_posix()
        files_by_stage.setdefault(stage, {})[contrast] = {
            "sequence_sets_parquet": f"{relative}/sequence_sets.parquet",
            "memberships_parquet": f"{relative}/memberships.parquet",
            "curves_parquet": f"{relative}/curves.parquet",
        }
        sources = set(chunk.terms["source"].unique().to_list())
        sources_by_stage.setdefault(stage, set()).update(sources)
        all_sources.update(sources)
        term_count += chunk.terms.height
        membership_count += memberships.height
    results = [
        {
            "id": stage,
            "label": label,
            "sources": sorted(sources_by_stage[stage]),
            "contrasts": files_by_stage[stage],
        }
        for stage, label in RESULT_LABELS.items()
        if stage in files_by_stage
    ]
    return {"results": results, "documents": gsea.documents}, {
        "terms": term_count,
        "memberships": membership_count,
        "sources": all_sources,
    }


def _write_method(
    staging: Path,
    tables: PreparedTables,
    annotations: AnnotationTables,
    models: dict[str, list[dict]],
    cache_root: Path,
    context_files: dict[str, Path],
    preparation: str,
    gsea: GseaInput | None = None,
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
            "pae_url": _pae_url(model, cache_root),
            "context_url": (
                f"residue_context/{context_files[model['file']].name}"
                if model["file"] in context_files
                else None
            ),
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
            "pae_url": pl.String,
            "context_url": pl.String,
        },
    )
    structures_table.write_parquet(staging / "tables" / "structures.parquet")
    _link_pae_files(staging, structures_table["pae_url"].drop_nulls().to_list(), cache_root)
    _link_residue_contexts(
        staging, structures_table["context_url"].drop_nulls().to_list(), context_files
    )
    structural_context = site_structural_context(tables.sites, context_files)
    structural_context.write_parquet(staging / "tables" / "site_structural_context.parquet")
    gsea_manifest = None
    gsea_summary = None
    if gsea is not None:
        gsea_manifest, gsea_summary = _write_gsea_tables(
            staging, gsea, tables.method, tables.sites, tables.contrasts
        )

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
        counts["gsea_terms"] = gsea_summary["terms"]
        counts["gsea_sources"] = len(gsea_summary["sources"])
        counts["gsea_memberships"] = gsea_summary["memberships"]
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
        manifest["gsea"] = gsea_manifest
    (staging / "data" / "run.json").write_text(json.dumps(manifest, indent=2))
    write_plot_backgrounds(staging, tables.stats, tables.contrasts)
    browser_assets.install_browser_assets(staging)
    return manifest


def _replace_directory(staging: Path, target: Path) -> None:
    backup = target.with_name(f".{target.name}.previous")
    if backup.exists():
        msg = f"Previous preparation backup needs inspection before retrying: {backup}"
        raise FileExistsError(msg)
    if target.exists():
        prepared_root.assert_owned_method(target, target.name)
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
    gsea: dict[str, GseaInput],
    output_dir: Path,
    methods: tuple[str, ...] = tuple(METHOD_SPECS),
    cache_root: Path | None = None,
) -> list[dict]:
    """Prepare requested methods from one validated MuData source."""
    cache_root = cache_root or DEFAULT_CACHE_ROOT
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
    prepared_root.write_method_chooser(output_dir)
    return manifests


def prepare_stats(
    input_file: Path,
    output_dir: Path,
    methods: tuple[str, ...] = tuple(METHOD_SPECS),
    cache_root: Path | None = None,
) -> list[dict]:
    """Prepare quantification and DEA Parquet tables from the statistics stage."""
    if not input_file.exists():
        raise FileNotFoundError(input_file)
    output_dir.mkdir(parents=True, exist_ok=True)
    with _statistics_source(input_file, output_dir) as (statistics_file, stage):
        return _prepare_from_mudata(
            statistics_file,
            stage,
            "stats",
            {},
            output_dir,
            methods,
            cache_root,
        )


def prepare_gsea(
    input_file: Path,
    output_dir: Path,
    methods: tuple[str, ...] = tuple(METHOD_SPECS),
    cache_root: Path | None = None,
) -> list[dict]:
    """Prepare stats and GSEA tables from a completed delivery ZIP or folder."""
    if not input_file.exists():
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
    return prepared_root.is_prepared(directory, method)
