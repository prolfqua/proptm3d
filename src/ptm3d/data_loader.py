"""Load differential PTM quantification tables and standardize them to the internal schema."""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import TYPE_CHECKING

import polars as pl

if TYPE_CHECKING:
    from collections.abc import Callable

_UNIPROT_IN_HEADER = re.compile(r"(?:sp|tr)\|([A-Z0-9]{6,10}(?:-\d+)?)\|")
_UNIPROT_DIRECT = re.compile(r"^[A-Z0-9]{6,10}(?:-\d+)?$")

# Aliases produced by prophosqua, MaxQuant, FragPipe, Spectronaut, or custom tables,
# mapped to the internal column schema shared by all ptm3d modules.
_COLUMN_ALIASES: dict[str, str] = {
    "protein_Id": "raw_protein_id",
    "protein_id": "raw_protein_id",
    "posInProtein": "pos_in_protein",
    "position": "pos_in_protein",
    "modAA": "mod_aa",
    "diff.site": "log2fc",
    "log2FC": "log2fc",
    "logFC": "log2fc",
    "FDR.site": "fdr",
    "FDR": "fdr",
    "p.value": "p_value",
    "pvalue": "p_value",
    "SequenceWindow": "sequence_window",
    "site": "site_name",
}

_NUMERIC_COLUMNS = ("pos_in_protein", "log2fc", "fdr")


def parse_uniprot_accession(protein_str: object) -> str | None:
    """Extract a clean UniProt accession from a protein identifier.

    Args:
        protein_str: Identifier such as ``sp|O14974|MYPT1_HUMAN`` or ``O14974``.

    Returns:
        The bare accession, or ``None`` when the input is missing.
    """
    if protein_str is None or (isinstance(protein_str, float) and math.isnan(protein_str)):
        return None
    text = str(protein_str).strip()
    match = _UNIPROT_IN_HEADER.search(text)
    if match:
        return match.group(1)
    if _UNIPROT_DIRECT.match(text):
        return text
    parts = text.split("|")
    if len(parts) >= 2:
        return parts[1]
    return text


def _read_excel(path: Path, sheet_name: int | str) -> pl.DataFrame:
    """Read one Excel sheet; integer ``sheet_name`` is 0-based like the CSV readers."""
    if isinstance(sheet_name, str):
        return pl.read_excel(path, sheet_name=sheet_name)
    return pl.read_excel(path, sheet_id=sheet_name + 1)  # Polars sheet_id is 1-based.


def load_ptm_data(file_path: Path | str, sheet_name: int | str = 0) -> pl.DataFrame:
    """Load PTM differential analysis results from an Excel, CSV, or TSV file.

    Column aliases from common upstream tools are renamed to the internal schema
    (``uniprot_acc``, ``pos_in_protein``, ``mod_aa``, ``log2fc``, ``fdr``, ...).

    Args:
        file_path: Path to the results table.
        sheet_name: Sheet to read (0-based index or name) when the file is an Excel workbook.

    Returns:
        The standardized PTM table.

    Raises:
        FileNotFoundError: The file does not exist.
        ValueError: The file extension is not supported.
        KeyError: No protein identifier column was found.
    """
    path = Path(file_path)
    if not path.exists():
        message = f"File not found: {path}"
        raise FileNotFoundError(message)

    readers: dict[str, Callable[[Path], pl.DataFrame]] = {
        ".xlsx": lambda p: _read_excel(p, sheet_name),
        ".xls": lambda p: _read_excel(p, sheet_name),
        ".csv": pl.read_csv,
        ".tsv": lambda p: pl.read_csv(p, separator="\t"),
        ".txt": lambda p: pl.read_csv(p, separator="\t"),
    }
    reader = readers.get(path.suffix.lower())
    if reader is None:
        message = f"Unsupported file format: {path.suffix}"
        raise ValueError(message)
    df = reader(path)

    renames = {
        alias: target
        for alias, target in _COLUMN_ALIASES.items()
        if alias in df.columns and target not in df.columns
    }
    df = df.rename(renames)

    if "raw_protein_id" in df.columns:
        df = df.with_columns(
            pl.col("raw_protein_id")
            .map_elements(parse_uniprot_accession, return_dtype=pl.String)
            .alias("uniprot_acc")
        )
    elif "uniprot_acc" not in df.columns:
        message = (
            "Could not find protein identifier column (e.g. protein_Id / protein_id / uniprot_acc)"
        )
        raise KeyError(message)

    casts = [
        pl.col(column).cast(pl.Float64, strict=False)
        for column in _NUMERIC_COLUMNS
        if column in df.columns
    ]
    if casts:
        df = df.with_columns(casts)

    return df


def filter_ptm_data(
    df: pl.DataFrame,
    protein_acc: str | None = None,
    min_fdr: float | None = None,
    contrast: str | None = None,
) -> pl.DataFrame:
    """Filter a PTM table by protein accession, FDR threshold, or contrast.

    Args:
        df: Standardized PTM table from :func:`load_ptm_data`.
        protein_acc: Keep only rows for this UniProt accession.
        min_fdr: Keep only rows with ``fdr`` at or below this threshold.
        contrast: Keep only rows for this condition comparison.

    Returns:
        The filtered table.
    """
    filtered = df
    if protein_acc:
        filtered = filtered.filter(pl.col("uniprot_acc") == protein_acc)
    if contrast and "contrast" in filtered.columns:
        filtered = filtered.filter(pl.col("contrast") == contrast)
    if min_fdr is not None and "fdr" in filtered.columns:
        filtered = filtered.filter(pl.col("fdr") <= min_fdr)
    return filtered
