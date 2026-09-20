"""Build the per-protein data payloads consumed by the browser apps."""

from __future__ import annotations

from typing import Any

import polars as pl


def _float_or(row: dict[str, Any], key: str, default: float) -> float:
    """Read a float from a row dict, falling back on a missing column or null value."""
    value = row.get(key)
    return default if value is None else float(value)


def build_ptm_records(
    ptm_df: pl.DataFrame, res_df: pl.DataFrame, protein_acc: str
) -> list[dict[str, Any]]:
    """Convert PTM rows into the JSON records the browser app renders.

    Each record carries the modification site, statistics, and the residue's 3D
    coordinates and pLDDT/exposure annotations when the structure covers it.

    Args:
        ptm_df: Standardized PTM table for one protein.
        res_df: Residue table from :mod:`proptm3d.structural_context`.
        protein_acc: UniProt accession used for fallback site names.

    Returns:
        One JSON-serializable dict per PTM site with a valid position and log2FC.
    """
    valid_ptms = ptm_df.drop_nulls(subset=["pos_in_protein", "log2fc"])
    records: list[dict[str, Any]] = []
    for row in valid_ptms.iter_rows(named=True):
        res_num = int(row["pos_in_protein"])
        log2fc = float(row["log2fc"])
        mod_aa = str(row.get("mod_aa") or "")

        plddt_val = None
        ppse_val = None
        x_val, y_val, z_val = None, None, None
        if not res_df.is_empty():
            match_res = res_df.filter(pl.col("res_num") == res_num)
            if match_res.height:
                plddt_val = float(match_res["plddt"][0])
                x_val = float(match_res["x"][0])
                y_val = float(match_res["y"][0])
                z_val = float(match_res["z"][0])
                if "ppse" in match_res.columns:
                    ppse_val = float(match_res["ppse"][0])

        records.append(
            {
                "res_num": res_num,
                "mod_aa": mod_aa,
                "log2fc": log2fc,
                "fdr": _float_or(row, "fdr", 1.0),
                "p_value": _float_or(row, "p_value", 1.0),
                "site_name": str(row.get("site_name") or f"{protein_acc}_{mod_aa}{res_num}"),
                "seq_window": str(row.get("sequence_window") or ""),
                "contrast": str(row.get("contrast") or "Default"),
                "imputed": bool(row.get("imputed") or False),
                "plddt": plddt_val,
                "ppse": ppse_val,
                "x": x_val,
                "y": y_val,
                "z": z_val,
            }
        )
    return records


def build_protein_payload(
    ptm_df: pl.DataFrame,
    res_df: pl.DataFrame,
    protein_acc: str,
    gene_name: str,
    pdb_file: str,
) -> dict[str, Any]:
    """Build one protein's data payload for the browser apps.

    Serialization is a separate concern: the caller hands the payload to a
    :class:`proptm3d.payload_io.PayloadWriter`.

    Args:
        ptm_df: Standardized PTM table for this protein.
        res_df: Residue table from :mod:`proptm3d.structural_context`.
        protein_acc: UniProt accession.
        gene_name: Gene symbol.
        pdb_file: Path of the structure file, relative to the served output root.

    Returns:
        The JSON-serializable payload.
    """
    return {
        "gene_name": gene_name,
        "uniprot_acc": protein_acc,
        "seq_len": res_df.height,
        "protein_length": _protein_length(ptm_df, res_df),
        "sequence": _sequence(res_df),
        "pdb_file": pdb_file,
        "protein_log2fc": _protein_log2fc_by_contrast(ptm_df),
        "ptms": build_ptm_records(ptm_df, res_df, protein_acc),
    }


def _sequence(res_df: pl.DataFrame) -> str:
    """One-letter sequence of the structure's residues in residue-number order."""
    if res_df.is_empty():
        return ""
    return "".join(res_df.sort("res_num")["res_aa"].to_list())


def _protein_length(ptm_df: pl.DataFrame, res_df: pl.DataFrame) -> int:
    """Protein length as the quantification reported it, else the structure's residue count."""
    if "protein_length" in ptm_df.columns:
        lengths = ptm_df["protein_length"].drop_nulls()
        if len(lengths):
            return int(lengths[0])
    return res_df.height


def _protein_log2fc_by_contrast(ptm_df: pl.DataFrame) -> dict[str, float]:
    """The protein-level log2FC per contrast, for the N-to-C plot's protein band."""
    if "protein_log2fc" not in ptm_df.columns or "contrast" not in ptm_df.columns:
        return {}
    means = (
        ptm_df.drop_nulls(subset=["protein_log2fc"])
        .group_by("contrast")
        .agg(pl.col("protein_log2fc").mean())
    )
    return {
        str(row["contrast"]): float(row["protein_log2fc"]) for row in means.iter_rows(named=True)
    }
