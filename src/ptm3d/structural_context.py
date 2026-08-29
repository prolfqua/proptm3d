"""Residue-level structural annotations: pLDDT, CA-neighbor exposure, and IDR detection.

The exposure score is a simple count of C-alpha atoms within a radius. It is inspired by,
but not equivalent to, the prediction-aware part-sphere exposure (pPSE) of Bludau et al.
(PLoS Biology 2022).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import polars as pl

_AA_3TO1 = {
    "ALA": "A", "CYS": "C", "ASP": "D", "GLU": "E", "PHE": "F",
    "GLY": "G", "HIS": "H", "ILE": "I", "LYS": "K", "LEU": "L",
    "MET": "M", "ASN": "N", "PRO": "P", "GLN": "Q", "ARG": "R",
    "SER": "S", "THR": "T", "VAL": "V", "TRP": "W", "TYR": "Y",
}  # fmt: skip

IDR_PLDDT_THRESHOLD = 70.0
DEEP_IDR_PLDDT_THRESHOLD = 50.0
EXPOSED_NEIGHBOR_THRESHOLD = 5.0


def parse_pdb_residues(pdb_path: Path | str) -> pl.DataFrame:
    """Parse CA atoms from a PDB file into a residue table.

    In AlphaFold models the B-factor column stores the pLDDT confidence score.

    Args:
        pdb_path: Path to the PDB file.

    Returns:
        One row per residue with columns ``res_num``, ``res_aa``, ``res_name3``,
        ``chain_id``, ``x``, ``y``, ``z``, and ``plddt``.

    Raises:
        FileNotFoundError: The PDB file does not exist.
    """
    path = Path(pdb_path)
    if not path.exists():
        message = f"PDB file not found: {path}"
        raise FileNotFoundError(message)

    residues = []
    with path.open(encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            if line.startswith("ATOM  ") and line[12:16].strip() == "CA":
                res_name3 = line[17:20].strip()
                residues.append(
                    {
                        "res_num": int(line[22:26]),
                        "res_aa": _AA_3TO1.get(res_name3, "X"),
                        "res_name3": res_name3,
                        "chain_id": line[21].strip(),
                        "x": float(line[30:38]),
                        "y": float(line[38:46]),
                        "z": float(line[46:54]),
                        "plddt": float(line[60:66]),
                    }
                )

    df = pl.DataFrame(residues)
    if not df.is_empty():
        df = df.unique(subset=["res_num"], keep="first", maintain_order=True).sort("res_num")
    return df


def calculate_ppse(res_df: pl.DataFrame, radius: float = 12.0) -> pl.DataFrame:
    """Compute a CA-neighbor-count exposure score per residue.

    Counts the C-alpha atoms within ``radius`` of each residue. A high count means a
    buried/structured environment; a low count means an exposed position.

    Args:
        res_df: Residue table from :func:`parse_pdb_residues`.
        radius: Neighbor radius in Angstrom.

    Returns:
        The residue table with an added ``ppse`` column.
    """
    if res_df.is_empty():
        return res_df

    coords = res_df.select("x", "y", "z").to_numpy()
    deltas = coords[:, None, :] - coords[None, :, :]
    distances = np.sqrt((deltas**2).sum(axis=2))
    counts = (distances <= radius).sum(axis=1) - 1  # Exclude self.
    return res_df.with_columns(pl.Series("ppse", counts))


def annotate_structural_regions(
    res_df: pl.DataFrame, plddt_window: int = 5, ppse_window: int = 5
) -> pl.DataFrame:
    """Annotate structured versus intrinsically disordered regions (IDRs).

    Uses smoothed pLDDT and exposure scores, following Bludau et al. (2022).

    Args:
        res_df: Residue table with ``plddt`` (and optionally ``ppse``) columns.
        plddt_window: Rolling window for pLDDT smoothing.
        ppse_window: Rolling window for exposure smoothing.

    Returns:
        The residue table with ``plddt_smooth``, ``ppse_smooth``, ``is_idr``,
        ``is_deep_idr``, and ``is_exposed`` columns added.
    """
    if res_df.is_empty():
        return res_df

    res_df = res_df.with_columns(
        pl.col("plddt")
        .rolling_mean(window_size=plddt_window, center=True, min_samples=1)
        .alias("plddt_smooth")
    )
    if "ppse" in res_df.columns:
        res_df = res_df.with_columns(
            pl.col("ppse")
            .rolling_mean(window_size=ppse_window, center=True, min_samples=1)
            .alias("ppse_smooth")
        )
    else:
        res_df = res_df.with_columns(pl.lit(0.0).alias("ppse_smooth"))

    return res_df.with_columns(
        (pl.col("plddt_smooth") < IDR_PLDDT_THRESHOLD).alias("is_idr"),
        (pl.col("plddt_smooth") < DEEP_IDR_PLDDT_THRESHOLD).alias("is_deep_idr"),
        (pl.col("ppse_smooth") <= EXPOSED_NEIGHBOR_THRESHOLD).alias("is_exposed"),
    )
