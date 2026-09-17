"""Read completed prophosqua tables and enrichment documents directly from MuData."""

from __future__ import annotations

import json
from pathlib import Path

import h5py
import numpy as np
import polars as pl

_TABLES = {
    "DPA": ("enriched", "dpa_dpu", "combined_site_prot"),
    "DPU": ("enriched", "dpa_dpu", "combined_test_diff"),
    "CF": ("cf", "report_data", "results"),
}
_EFFECT_COLUMNS = {
    "DPA": ("diff.site", "FDR.site"),
    "DPU": ("diff_diff", "FDR_I"),
    "CF": ("diff.site", "FDR.site"),
}


def _analysis_name(analysis: str | int) -> str:
    name = ("DPA", "DPU", "CF")[analysis] if isinstance(analysis, int) else analysis
    if name not in _TABLES:
        message = f"Unknown PTM analysis: {name}"
        raise ValueError(message)
    return name


def _validate_stage(handle: h5py.File) -> None:
    namespace = handle["uns/prophosqua"]
    if namespace["stage"].asstr()[()] != "PTM_results":
        message = "ptm3d requires the completed PTM_results MuData stage"
        raise ValueError(message)
    if namespace["schema_version"].asstr()[()] != "2.0.0":
        message = "Unsupported prophosqua MuData schema"
        raise ValueError(message)


def _record_item(group: h5py.Group, name: str) -> h5py.Group:
    names = np.atleast_1d(group["names"].asstr()[()]).tolist()
    index = names.index(name) + 1
    return group[f"items/item_{index:06d}"]


def _column_values(group: h5py.Group) -> list:
    storage = group["storage"].asstr()[()]
    dataset = group["values"]
    values = dataset.asstr()[()] if storage == "character" else dataset[()]
    result = np.atleast_1d(values).tolist()
    if "missing" in group:
        missing = np.atleast_1d(group["missing"][()]).astype(bool).tolist()
        result = [None if absent else value for value, absent in zip(result, missing, strict=True)]
    if storage == "character":
        return [None if value == "" else value for value in result]
    return result


def read_ptm_mudata(path: Path, analysis: str | int) -> pl.DataFrame:
    """Read the existing complete DPA, DPU or CF result and its annotations.

    Numeric effect/FDR columns are selected by the requested analysis before
    the regular column-alias mapping, so DPU uses the protein-corrected effect.
    """
    name = _analysis_name(analysis)
    modality, record, table = _TABLES[name]
    with h5py.File(path, "r") as handle:
        _validate_stage(handle)
        source = handle[f"mod/{modality}/uns/prophosqua/{record}"]
        frame = _record_item(source, table)
        columns = np.atleast_1d(frame["columns/names"].asstr()[()]).tolist()
        data = pl.DataFrame(
            {column: _column_values(_record_item(frame["columns"], column)) for column in columns}
        )
    effect, fdr = _EFFECT_COLUMNS[name]
    annotation = "gene_name.site" if "gene_name.site" in data.columns else "gene_name"
    return data.select(
        "protein_Id",
        "site",
        "contrast",
        "posInProtein",
        "modAA",
        "SequenceWindow",
        pl.col(annotation).alias("gene_name"),
        pl.col(effect).alias("diff.site"),
        pl.col(fdr).alias("FDR.site"),
    )


def read_mudata_enrichment(path: Path, analysis: str | int) -> list[dict]:
    """Read the selected analysis's embedded GSEAResult documents."""
    name = _analysis_name(analysis)
    modality = "enriched" if name == "DPA" else "cf"
    with h5py.File(path, "r") as handle:
        _validate_stage(handle)
        namespace = handle[f"mod/{modality}/uns/prophosqua"]
        if "enrichment_documents" not in namespace:
            return []
        documents = namespace["enrichment_documents"]
        return [
            json.loads(documents[key]["json"].asstr()[()])
            for key in documents
            if key.endswith(f"__{name}")
        ]
