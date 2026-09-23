"""Extract browser-ready PTM statistics and paired sample values from final MuData."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import h5py
import numpy as np
import polars as pl

from proptm3d.data_loader import parse_uniprot_accession
from proptm3d.mudata_reader import _validate_stage


@dataclass(frozen=True, slots=True)
class MethodSpec:
    """Paths and result columns for one public analysis method."""

    modality: str
    result_method: str
    effect: str
    fdr: str
    p_value: str
    std_error: str


METHOD_SPECS = {
    "DPA": MethodSpec(
        "enriched",
        "dpa",
        "diff.site",
        "FDR.site",
        "p.value.site",
        "std.error.site",
    ),
    "DPU": MethodSpec(
        "enriched",
        "dpu",
        "diff_diff",
        "FDR_I",
        "pValue_I",
        "SE_I",
    ),
    "CF-DPU": MethodSpec(
        "cf",
        "correct_first",
        "diff.site",
        "FDR.site",
        "p.value",
        "std.error",
    ),
}

SCHEMA_VERSION = "1"
_RESULT_COLUMNS = (
    "protein_Id",
    "site",
    "contrast",
    "posInProtein",
    "modAA",
    "SequenceWindow",
    "gene_name.site",
    "gene_name",
    "protein_length",
    "diff.site",
    "diff.protein",
    "estimate_type",
    "estimate_type.site",
    "estimate_type.protein",
)
_SITE_COLUMNS = (
    "protein_Id",
    "site",
    "fasta.id",
    "gene_name",
    "protein_length",
    "posInProtein",
    "modAA",
    "SequenceWindow",
)


@dataclass(slots=True)
class PreparedTables:
    """The tables consumed by file generation, without any external annotations."""

    method: str
    contrasts: list[str]
    samples: list[dict[str, str]]
    sites: pl.DataFrame
    stats: pl.DataFrame
    measurements: pl.DataFrame
    proteins: pl.DataFrame


def _strings(dataset: h5py.Dataset) -> list[str]:
    return np.atleast_1d(dataset.asstr()[()]).tolist()


def _result_frame(
    handle: h5py.File,
    modality: str,
    result_method: str,
    desired: tuple[str, ...],
) -> pl.DataFrame:
    source = handle[f"mod/{modality}"]
    namespace = source["uns/prophosqua"]
    keys = _strings(namespace[f"result_keys/{result_method}"])
    if not keys:
        msg = f"No {result_method} result keys"
        raise ValueError(msg)
    required = {"protein_Id", "site", "contrast"}
    frames = []
    for key in keys:
        prefix = f"{result_method}__"
        if not key.startswith(prefix):
            msg = f"Unexpected {result_method} result key: {key}"
            raise ValueError(msg)
        contrast = key[len(prefix) :]
        columns = _strings(namespace[f"varm_columns/{key}"])
        annotations = namespace[f"varm_annotations/{key}"]
        available = set(source["var"]) | set(columns) | set(annotations) | {"contrast"}
        missing = required - available
        if missing:
            msg = f"{result_method} lacks required columns: {sorted(missing)}"
            raise ValueError(msg)
        selected = [name for name in desired if name in available]
        present = source[f"varm/{key}__present"][()].reshape(-1).astype(bool)
        values = source[f"varm/{key}"][()]
        if values.shape != (len(present), len(columns)):
            msg = f"Result matrix and columns disagree for {key}"
            raise ValueError(msg)
        selected_rows = np.flatnonzero(present)
        fields = {}
        for name in selected:
            if name == "contrast":
                fields[name] = [contrast] * len(selected_rows)
            elif name in columns:
                column = values[selected_rows, columns.index(name)]
                fields[name] = [float(value) if np.isfinite(value) else None for value in column]
            else:
                dataset = annotations[name] if name in annotations else source[f"var/{name}"]
                column = _strings(dataset) if dataset.dtype.kind in "OSU" else dataset[()].tolist()
                if "as.na" in dataset.attrs:
                    column = [None if value == "NA" else value for value in column]
                fields[name] = [column[index] for index in selected_rows]
        frames.append(pl.DataFrame(fields))
    return pl.concat(frames, how="diagonal_relaxed")


def _site_frame(modality: h5py.Group) -> pl.DataFrame:
    var = modality["var"]
    available = set(var)
    missing = set(_SITE_COLUMNS) - available
    if missing:
        message = f"Site modality lacks required annotations: {sorted(missing)}"
        raise ValueError(message)
    fields = {
        name: _strings(var[name]) if var[name].dtype.kind in "OSU" else var[name][()].tolist()
        for name in _SITE_COLUMNS
    }
    sites = (
        pl.DataFrame(fields)
        .filter(pl.col("fasta.id").str.contains(r"^(?:contam_)?(?:sp|tr)\|"))
        .with_columns(
            pl.col("fasta.id")
            .map_elements(parse_uniprot_accession, return_dtype=pl.String)
            .alias("accession")
        )
    )
    if sites.select(pl.struct("protein_Id", "site").n_unique()).item() != sites.height:
        msg = "Site matrix contains duplicate protein/site keys"
        raise ValueError(msg)
    return sites


def _sample_frame(modality: h5py.Group) -> list[dict[str, str]]:
    obs = modality["obs"]
    names = _strings(obs["Name"])
    conditions = _strings(obs["G_"])
    if len(names) != len(set(names)):
        msg = "Sample names are not unique"
        raise ValueError(msg)
    return [
        {"sample": name, "condition": condition}
        for name, condition in zip(names, conditions, strict=True)
    ]


def _matrix_by_site(
    modality: h5py.Group, requested: list[str], samples: list[dict[str, str]]
) -> np.ndarray:
    source_samples = _sample_frame(modality)
    sample_lookup = {item["sample"]: index for index, item in enumerate(source_samples)}
    if set(sample_lookup) != {item["sample"] for item in samples}:
        msg = "Sample identities differ between MuData modalities"
        raise ValueError(msg)
    source_sites = _strings(modality["var/site"])
    site_lookup = {site: index for index, site in enumerate(source_sites)}
    if len(site_lookup) != len(source_sites):
        msg = "Source modality contains duplicate sites"
        raise ValueError(msg)
    missing = set(requested) - site_lookup.keys()
    if missing:
        message = f"Modality lacks {len(missing)} required sites"
        raise ValueError(message)
    row_indices = [sample_lookup[item["sample"]] for item in samples]
    column_indices = [site_lookup[site] for site in requested]
    matrix = modality["X"][()]
    return matrix[np.ix_(row_indices, column_indices)]


def _protein_matrix(
    modality: h5py.Group, fasta_ids: list[str], samples: list[dict[str, str]]
) -> np.ndarray:
    source_samples = _sample_frame(modality)
    sample_lookup = {item["sample"]: index for index, item in enumerate(source_samples)}
    if set(sample_lookup) != {item["sample"] for item in samples}:
        msg = "Sample identities differ between MuData modalities"
        raise ValueError(msg)
    protein_ids = _strings(modality["var/protein_Id"])
    protein_lookup = {protein_id: index for index, protein_id in enumerate(protein_ids)}
    if len(protein_lookup) != len(protein_ids):
        msg = "Total-protein modality contains duplicate protein IDs"
        raise ValueError(msg)
    output = np.full((len(samples), len(fasta_ids)), np.nan)
    matched = [
        (index, protein_lookup[fasta])
        for index, fasta in enumerate(fasta_ids)
        if fasta in protein_lookup
    ]
    if matched:
        source = modality["X"][()]
        row_indices = [sample_lookup[item["sample"]] for item in samples]
        target_columns, source_columns = zip(*matched, strict=True)
        output[:, list(target_columns)] = source[np.ix_(row_indices, source_columns)]
    return output


def _stats_frame(handle: h5py.File, spec: MethodSpec) -> pl.DataFrame:
    desired = (*_RESULT_COLUMNS, spec.effect, spec.fdr, spec.p_value, spec.std_error)
    raw = _result_frame(handle, spec.modality, spec.result_method, desired)
    required = {spec.effect, spec.fdr}
    missing = required - set(raw.columns)
    if missing:
        message = f"{spec.result_method} lacks required result columns: {sorted(missing)}"
        raise ValueError(message)
    raw = raw.filter(pl.col("site").is_not_null())
    gene_column = "gene_name.site" if "gene_name.site" in raw.columns else "gene_name"
    selected = [
        pl.col("protein_Id"),
        pl.col("site"),
        pl.col("contrast"),
        pl.col("posInProtein").cast(pl.Int64, strict=False),
        pl.col("modAA"),
        pl.col("SequenceWindow").alias("sequence_window"),
        pl.col(gene_column).alias("gene_name"),
        pl.col("protein_length").cast(pl.Int64, strict=False),
        pl.col(spec.effect).cast(pl.Float64, strict=False).alias("effect"),
        pl.col(spec.fdr).cast(pl.Float64, strict=False).alias("fdr"),
        pl.col(spec.p_value).cast(pl.Float64, strict=False).alias("p_value"),
        pl.col(spec.std_error).cast(pl.Float64, strict=False).alias("std_error"),
    ]
    stats = raw.select(selected)
    site_estimate = "estimate_type" if "estimate_type" in raw.columns else "estimate_type.site"
    stats = stats.with_columns(
        raw[site_estimate].alias("site_estimate_type"),
        (
            raw["estimate_type.protein"]
            if "estimate_type.protein" in raw.columns
            else pl.Series("protein_estimate_type", [None] * raw.height, dtype=pl.String)
        ).alias("protein_estimate_type"),
    )
    stats = stats.with_columns(
        (
            (pl.col("site_estimate_type") == "lod_imputed")
            | (pl.col("protein_estimate_type") == "lod_imputed")
        )
        .fill_null(False)
        .alias("imputed")
    )
    dpa_spec = METHOD_SPECS["DPA"]
    source = _result_frame(
        handle,
        dpa_spec.modality,
        dpa_spec.result_method,
        ("protein_Id", "site", "contrast", "diff.site", "diff.protein"),
    ).filter(pl.col("site").is_not_null())
    lookup = source.select(
        "protein_Id",
        "site",
        "contrast",
        pl.col("diff.site").cast(pl.Float64, strict=False).alias("original_site_fc"),
        pl.col("diff.protein").cast(pl.Float64, strict=False).alias("protein_fc"),
    )
    stats = stats.join(lookup, on=["protein_Id", "site", "contrast"], how="left")
    if stats.select(pl.struct("protein_Id", "site", "contrast").n_unique()).item() != stats.height:
        msg = f"{spec.result_method} contains duplicate site/contrast keys"
        raise ValueError(msg)
    return stats


def _measurements(
    sites: pl.DataFrame,
    samples: list[dict[str, str]],
    site_values: np.ndarray,
    protein_values: np.ndarray | None,
    corrected_values: np.ndarray | None,
) -> pl.DataFrame:
    n_sites = sites.height
    n_samples = len(samples)
    if site_values.shape != (n_samples, n_sites):
        msg = "Site abundance matrix does not match site/sample annotations"
        raise ValueError(msg)

    def values_or_null(matrix: np.ndarray | None, name: str) -> pl.Series:
        if matrix is None:
            return pl.Series(name, [None] * (n_sites * n_samples), dtype=pl.Float64)
        values = matrix.T.reshape(-1)
        values = np.where(np.isfinite(values), values, np.nan)
        return pl.Series(name, values, nan_to_null=True)

    return pl.DataFrame(
        {
            "protein_Id": np.repeat(sites["protein_Id"].to_numpy(), n_samples),
            "site": np.repeat(sites["site"].to_numpy(), n_samples),
            "sample": np.tile([item["sample"] for item in samples], n_sites),
            "condition": np.tile([item["condition"] for item in samples], n_sites),
        }
    ).with_columns(
        values_or_null(site_values, "site_abundance"),
        values_or_null(protein_values, "protein_abundance"),
        values_or_null(corrected_values, "corrected_abundance"),
    )


def read_prepared_tables(path: Path, method: str) -> PreparedTables:
    """Read one method and aligned evidence from PTM_statistics.h5mu."""
    spec = METHOD_SPECS[method]
    with h5py.File(path, "r") as handle:
        _validate_stage(handle, "PTM_statistics")
        site_modality = handle[f"mod/{spec.modality}"]
        sites = _site_frame(site_modality)
        samples = _sample_frame(site_modality)
        site_names = sites["site"].to_list()
        site_values = _matrix_by_site(handle["mod/enriched"], site_names, samples)
        protein_values = (
            _protein_matrix(handle["mod/total"], sites["fasta.id"].to_list(), samples)
            if method != "DPA"
            else None
        )
        corrected_values = (
            _matrix_by_site(handle["mod/cf"], site_names, samples) if method == "CF-DPU" else None
        )
        stats = _stats_frame(handle, spec).join(
            sites.select("protein_Id", "site"), on=["protein_Id", "site"], how="inner"
        )
    has_measurement = np.isfinite(site_values).any(axis=0)
    sites = sites.with_columns(pl.Series("has_measurement", has_measurement))
    proteins = sites.group_by("protein_Id", maintain_order=True).agg(
        pl.col("accession").first(),
        pl.col("gene_name").first(),
        pl.col("protein_length").first().cast(pl.Int64, strict=False),
        pl.col("site").n_unique().alias("detected_sites"),
        pl.col("has_measurement").sum().alias("measured_sites"),
    )
    if proteins["accession"].n_unique() != proteins.height:
        msg = "Several measured proteins share a UniProt accession; cannot name per-protein files"
        raise ValueError(msg)
    measurements = _measurements(sites, samples, site_values, protein_values, corrected_values)
    contrasts = stats["contrast"].unique(maintain_order=True).to_list()
    return PreparedTables(method, contrasts, samples, sites, stats, measurements, proteins)
