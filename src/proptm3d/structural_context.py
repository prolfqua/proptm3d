"""Residue-level structural context from AlphaFold models.

The production path implements the prediction-aware exposure and IDR procedure published
by Bludau et al. (PLoS Biology 2022) and implemented by MannLabs StructureMap. This is a
NumPy/Polars adaptation for proptm3d; it uses the same distances, angles, PAE correction,
smoothing window, and thresholds. StructureMap is Copyright 2020 MannLabs and Apache-2.0
licensed. This file is a modified, independently vectorized implementation.

The older PDB helpers at the end of this module remain for the legacy Python API.
"""

from __future__ import annotations

import gzip
import json
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from fcntl import LOCK_EX, LOCK_UN, flock
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl
from Bio.PDB.MMCIF2Dict import MMCIF2Dict
from loguru import logger

_AA_3TO1 = {
    "ALA": "A", "CYS": "C", "ASP": "D", "GLU": "E", "PHE": "F",
    "GLY": "G", "HIS": "H", "ILE": "I", "LYS": "K", "LEU": "L",
    "MET": "M", "ASN": "N", "PRO": "P", "GLN": "Q", "ARG": "R",
    "SER": "S", "THR": "T", "VAL": "V", "TRP": "W", "TYR": "Y",
}  # fmt: skip

IDR_PLDDT_THRESHOLD = 70.0
DEEP_IDR_PLDDT_THRESHOLD = 50.0
EXPOSED_NEIGHBOR_THRESHOLD = 5.0

CONTEXT_ALGORITHM_VERSION = "bludau-v1"
PART_SPHERE_DISTANCE = 12.0
PART_SPHERE_ANGLE = 70.0
FULL_SPHERE_DISTANCE = 24.0
FULL_SPHERE_ANGLE = 180.0
IDR_HALF_WINDOW = 10
IDR_NEIGHBOR_THRESHOLD = 34.27

CONTEXT_METADATA = {
    "algorithm": "Bludau et al. StructureMap prediction-aware exposure",
    "algorithm_version": CONTEXT_ALGORITHM_VERSION,
    "exposure": {
        "distance_angstrom": PART_SPHERE_DISTANCE,
        "angle_degrees": PART_SPHERE_ANGLE,
        "maximum_neighbors": EXPOSED_NEIGHBOR_THRESHOLD,
    },
    "idr": {
        "distance_angstrom": FULL_SPHERE_DISTANCE,
        "angle_degrees": FULL_SPHERE_ANGLE,
        "smoothing_half_window": IDR_HALF_WINDOW,
        "maximum_smoothed_neighbors": IDR_NEIGHBOR_THRESHOLD,
    },
}

_COORDINATE_COLUMNS = (
    "ca_x",
    "ca_y",
    "ca_z",
    "cb_x",
    "cb_y",
    "cb_z",
    "c_x",
    "c_y",
    "c_z",
    "n_x",
    "n_y",
    "n_z",
)

_ANNOTATION_COLUMNS = (
    "model_position",
    "position",
    "residue",
    "plddt",
    "nAA_12_70_pae",
    "is_exposed",
    "nAA_24_180_pae",
    "nAA_24_180_pae_smooth10",
    "is_idr",
)


def _cif_column(structure: dict[str, Any], name: str) -> list[str]:
    value = structure[name]
    return value if isinstance(value, list) else [value]


def _optional_cif_column(
    structure: dict[str, Any], name: str, size: int, default: str
) -> list[str]:
    if name not in structure:
        return [default] * size
    values = _cif_column(structure, name)
    if len(values) != size:
        message = f"mmCIF column {name} has {len(values)} values; expected {size}"
        raise ValueError(message)
    return values


def _integer(value: str) -> int | None:
    try:
        return int(value)
    except ValueError:
        return None


def parse_alphafold_cif(cif_path: Path | str, model_start: int | None = None) -> pl.DataFrame:
    """Read backbone/CB coordinates and pLDDT from an AlphaFold mmCIF model."""
    path = Path(cif_path)
    if not path.is_file():
        message = f"AlphaFold mmCIF file not found: {path}"
        raise FileNotFoundError(message)
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as stream:
            structure = MMCIF2Dict(stream)
    else:
        structure = MMCIF2Dict(str(path))

    atom_ids = _cif_column(structure, "_atom_site.label_atom_id")
    size = len(atom_ids)
    groups = _optional_cif_column(structure, "_atom_site.group_PDB", size, "ATOM")
    chains = _optional_cif_column(structure, "_atom_site.label_asym_id", size, "A")
    local_positions = _cif_column(structure, "_atom_site.label_seq_id")
    global_positions = _optional_cif_column(
        structure, "_atom_site.pdbx_sifts_xref_db_num", size, "?"
    )
    residue_names = _cif_column(structure, "_atom_site.label_comp_id")
    residue_codes = _optional_cif_column(structure, "_atom_site.pdbx_sifts_xref_db_res", size, "?")
    x_coords = _cif_column(structure, "_atom_site.Cartn_x")
    y_coords = _cif_column(structure, "_atom_site.Cartn_y")
    z_coords = _cif_column(structure, "_atom_site.Cartn_z")
    plddt = _cif_column(structure, "_atom_site.B_iso_or_equiv")
    columns = (
        groups,
        chains,
        local_positions,
        global_positions,
        residue_names,
        residue_codes,
        x_coords,
        y_coords,
        z_coords,
        plddt,
    )
    if any(len(column) != size for column in columns):
        msg = f"AlphaFold mmCIF atom columns have inconsistent lengths in {path}"
        raise ValueError(msg)

    residues: dict[tuple[str, int], dict[str, object]] = {}
    for index, atom_id in enumerate(atom_ids):
        if groups[index] != "ATOM" or atom_id not in {"CA", "CB", "C", "N"}:
            continue
        model_position = _integer(local_positions[index])
        if model_position is None:
            continue
        position = _integer(global_positions[index])
        if position is None:
            position = model_position if model_start is None else model_start + model_position - 1
        residue_code = residue_codes[index]
        residue = (
            residue_code
            if len(residue_code) == 1 and residue_code not in {"?", "."}
            else _AA_3TO1.get(residue_names[index], "X")
        )
        key = (chains[index], model_position)
        row = residues.setdefault(
            key,
            {
                "model_position": model_position,
                "position": position,
                "residue": residue,
                "plddt": None,
                **dict.fromkeys(_COORDINATE_COLUMNS),
            },
        )
        prefix = atom_id.lower()
        row[f"{prefix}_x"] = float(x_coords[index])
        row[f"{prefix}_y"] = float(y_coords[index])
        row[f"{prefix}_z"] = float(z_coords[index])
        if atom_id == "CA":
            row["plddt"] = float(plddt[index])

    rows = [row for row in residues.values() if row["ca_x"] is not None]
    if not rows:
        return pl.DataFrame(
            schema={
                "model_position": pl.Int64,
                "position": pl.Int64,
                "residue": pl.String,
                "plddt": pl.Float64,
                **dict.fromkeys(_COORDINATE_COLUMNS, pl.Float64),
            }
        )
    return pl.DataFrame(
        rows,
        schema_overrides={
            "model_position": pl.Int64,
            "position": pl.Int64,
            "residue": pl.String,
            "plddt": pl.Float64,
            **dict.fromkeys(_COORDINATE_COLUMNS, pl.Float64),
        },
    ).sort("model_position")


def load_pae(pae_path: Path | str) -> np.ndarray:
    """Load the current AlphaFold predicted-aligned-error JSON matrix."""
    path = Path(pae_path)
    opener = gzip.open if path.suffix == ".gz" else Path.open
    if path.suffix == ".gz":
        with opener(path, "rt", encoding="utf-8") as stream:
            payload = json.load(stream)
    else:
        with opener(path, encoding="utf-8") as stream:
            payload = json.load(stream)
    record = payload[0] if isinstance(payload, list) else payload
    matrix = np.asarray(record["predicted_aligned_error"], dtype=np.uint8)
    if matrix.ndim != 2 or matrix.shape[0] != matrix.shape[1]:
        message = f"PAE matrix must be square; got shape {matrix.shape} from {path}"
        raise ValueError(message)
    return matrix


def _rotate_vector(vector: np.ndarray, axis: np.ndarray, theta: float) -> np.ndarray:
    theta_radians = np.radians(theta)
    axis = axis / np.linalg.norm(axis)
    a = np.cos(theta_radians / 2.0)
    b, c, d = -axis * np.sin(theta_radians / 2.0)
    aa, bb, cc, dd = a * a, b * b, c * c, d * d
    bc, ad, ac, ab, bd, cd = b * c, a * d, a * c, a * b, b * d, c * d
    rotation = np.array(
        [
            [aa + bb - cc - dd, 2 * (bc + ad), 2 * (bd - ac)],
            [2 * (bc - ad), aa + cc - bb - dd, 2 * (cd + ab)],
            [2 * (bd + ac), 2 * (cd - ab), aa + dd - bb - cc],
        ]
    )
    return rotation @ vector


def _side_chain_directions(
    ca: np.ndarray, cb: np.ndarray, c_coord: np.ndarray, n_coord: np.ndarray
) -> np.ndarray:
    directions = cb - ca
    missing_cb = ~np.isfinite(directions).all(axis=1)
    for index in np.flatnonzero(missing_cb):
        n_vector = n_coord[index] - ca[index]
        c_vector = c_coord[index] - ca[index]
        if not np.isfinite(n_vector).all() or not np.isfinite(c_vector).all():
            directions[index] = np.nan
            continue
        n_norm = np.linalg.norm(n_vector)
        c_norm = np.linalg.norm(c_vector)
        if n_norm == 0 or c_norm == 0:
            directions[index] = np.nan
            continue
        directions[index] = _rotate_vector(n_vector / n_norm, c_vector / c_norm, -120.0)
    norms = np.linalg.norm(directions, axis=1)
    valid = np.isfinite(norms) & (norms > 0)
    directions[valid] /= norms[valid, None]
    directions[~valid] = np.nan
    return directions


def _bludau_neighbor_counts(
    residues: pl.DataFrame, pae: np.ndarray, block_size: int = 64
) -> tuple[np.ndarray, np.ndarray]:
    ca = residues.select("ca_x", "ca_y", "ca_z").to_numpy()
    cb = residues.select("cb_x", "cb_y", "cb_z").to_numpy()
    c_coord = residues.select("c_x", "c_y", "c_z").to_numpy()
    n_coord = residues.select("n_x", "n_y", "n_z").to_numpy()
    model_positions = residues["model_position"].to_numpy().astype(np.int64)
    if model_positions.size and (model_positions.min() < 1 or model_positions.max() > pae.shape[0]):
        message = (
            f"Model residue positions {model_positions.min()}..{model_positions.max()} "
            f"do not fit PAE shape {pae.shape}"
        )
        raise ValueError(message)
    pae_indices = model_positions - 1
    directions = _side_chain_directions(ca, cb, c_coord, n_coord)
    part_counts = np.zeros(residues.height, dtype=np.int64)
    full_counts = np.zeros(residues.height, dtype=np.int64)
    neighbor_indices = np.arange(residues.height)

    for start in range(0, residues.height, block_size):
        end = min(start + block_size, residues.height)
        deltas = ca[None, :, :] - ca[start:end, None, :]
        distances = np.linalg.norm(deltas, axis=2)
        with np.errstate(divide="ignore", invalid="ignore"):
            neighbor_directions = deltas / distances[:, :, None]
            dot_products = np.einsum("bnd,bd->bn", neighbor_directions, directions[start:end])
            angles = np.degrees(np.arccos(dot_products))
        paired_error = pae[np.ix_(pae_indices[start:end], pae_indices)]
        not_self = neighbor_indices[None, :] != neighbor_indices[start:end, None]
        full = (
            not_self
            & (paired_error <= FULL_SPHERE_DISTANCE)
            & (distances + paired_error <= FULL_SPHERE_DISTANCE)
            & (angles <= FULL_SPHERE_ANGLE)
        )
        part = (
            not_self
            & (paired_error <= PART_SPHERE_DISTANCE)
            & (distances + paired_error <= PART_SPHERE_DISTANCE)
            & (angles <= PART_SPHERE_ANGLE)
        )
        full_counts[start:end] = full.sum(axis=1)
        part_counts[start:end] = part.sum(axis=1)
    return part_counts, full_counts


def annotate_bludau_context(residues: pl.DataFrame, pae: np.ndarray) -> pl.DataFrame:
    """Calculate StructureMap-compatible exposure and IDR annotations."""
    missing = {"model_position", "position", "residue", "plddt", *_COORDINATE_COLUMNS} - set(
        residues.columns
    )
    if missing:
        message = f"Residue table lacks structural columns: {sorted(missing)}"
        raise ValueError(message)
    if residues.is_empty():
        return residues.select("model_position", "position", "residue", "plddt").with_columns(
            pl.Series("nAA_12_70_pae", [], dtype=pl.Int64),
            pl.Series("is_exposed", [], dtype=pl.Boolean),
            pl.Series("nAA_24_180_pae", [], dtype=pl.Int64),
            pl.Series("nAA_24_180_pae_smooth10", [], dtype=pl.Float64),
            pl.Series("is_idr", [], dtype=pl.Boolean),
        )
    part_counts, full_counts = _bludau_neighbor_counts(residues, pae)
    return (
        residues.select("model_position", "position", "residue", "plddt")
        .with_columns(
            pl.Series("nAA_12_70_pae", part_counts),
            pl.Series("nAA_24_180_pae", full_counts),
        )
        .with_columns(
            (pl.col("nAA_12_70_pae") <= EXPOSED_NEIGHBOR_THRESHOLD).alias("is_exposed"),
            pl.col("nAA_24_180_pae")
            .rolling_mean(window_size=2 * IDR_HALF_WINDOW + 1, center=True, min_samples=1)
            .alias("nAA_24_180_pae_smooth10"),
        )
        .with_columns((pl.col("nAA_24_180_pae_smooth10") <= IDR_NEIGHBOR_THRESHOLD).alias("is_idr"))
        .select(_ANNOTATION_COLUMNS)
    )


@contextmanager
def _context_lock(target: Path) -> Iterator[None]:
    lock = target.with_suffix(".lock")
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open("w") as handle:
        flock(handle, LOCK_EX)
        try:
            yield
        finally:
            flock(handle, LOCK_UN)


def model_context_path(model: dict, cache_root: Path) -> Path:
    """Return the versioned residue-context cache path for one AlphaFold model."""
    context_dir = cache_root / "alphafold" / "structural_context" / CONTEXT_ALGORITHM_VERSION
    return context_dir / f"{model['model_id']}-model_v{model['version']}.parquet"


def cache_model_contexts(
    models: dict[str, list[dict]],
    pae_files: dict[str, Path],
    cache_root: Path,
) -> dict[str, Path]:
    """Compute and cache one residue-context Parquet file per AlphaFold model."""
    context_dir = cache_root / "alphafold" / "structural_context" / CONTEXT_ALGORITHM_VERSION
    context_dir.mkdir(parents=True, exist_ok=True)
    structures = cache_root / "alphafold" / "structures"
    cached = {}
    for accession in sorted(models):
        for model in sorted(models[accession], key=lambda item: item["fragment"]):
            model_id = model["model_id"]
            target = model_context_path(model, cache_root)
            with _context_lock(target):
                if not target.is_file():
                    logger.debug("Computing structural context for {}", model_id)
                    residues = parse_alphafold_cif(
                        structures / model["file"], model_start=model.get("start")
                    )
                    annotated = annotate_bludau_context(
                        residues, load_pae(pae_files[model["file"]])
                    ).with_columns(
                        pl.lit(accession).alias("accession"),
                        pl.lit(model_id).alias("model_id"),
                        pl.lit(model["fragment"]).cast(pl.Int64).alias("fragment"),
                        pl.lit(model["version"]).cast(pl.Int64).alias("version"),
                    )
                    annotated = annotated.select(
                        "accession", "model_id", "fragment", "version", *_ANNOTATION_COLUMNS
                    )
                    with tempfile.NamedTemporaryFile(dir=context_dir, delete=False) as temporary:
                        staged = Path(temporary.name)
                    try:
                        annotated.write_parquet(staged)
                        staged.replace(target)
                    finally:
                        staged.unlink(missing_ok=True)
            cached[model["file"]] = target
    return cached


def site_structural_context(sites: pl.DataFrame, context_files: dict[str, Path]) -> pl.DataFrame:
    """Match cached residue context to PTM sites without collapsing model fragments."""
    site_columns = (
        "protein_Id",
        "site",
        "accession",
        "posInProtein",
        "modAA",
        "has_measurement",
    )
    base = sites.select(site_columns)
    groups = base.partition_by("accession", as_dict=True)
    matched = []
    for path in context_files.values():
        context = pl.read_parquet(path)
        if context.is_empty():
            continue
        accession = context["accession"][0]
        accession_sites = groups.get((accession,))
        if accession_sites is None:
            continue
        rows = accession_sites.join(
            context,
            left_on=["accession", "posInProtein"],
            right_on=["accession", "position"],
            how="inner",
        ).with_columns(
            pl.when(pl.col("modAA") == pl.col("residue"))
            .then(pl.lit("matched"))
            .otherwise(pl.lit("residue_mismatch"))
            .alias("mapping_status")
        )
        matched.append(rows)

    if matched:
        matches = pl.concat(matched, how="vertical_relaxed")
        matched_sites = matches.select("protein_Id", "site").unique()
    else:
        matches = None
        matched_sites = base.select("protein_Id", "site").clear()
    unavailable = base.join(matched_sites, on=["protein_Id", "site"], how="anti").with_columns(
        pl.lit(None, dtype=pl.String).alias("model_id"),
        pl.lit(None, dtype=pl.Int64).alias("fragment"),
        pl.lit(None, dtype=pl.Int64).alias("version"),
        pl.lit(None, dtype=pl.Int64).alias("model_position"),
        pl.lit(None, dtype=pl.String).alias("residue"),
        pl.lit(None, dtype=pl.Float64).alias("plddt"),
        pl.lit(None, dtype=pl.Int64).alias("nAA_12_70_pae"),
        pl.lit(None, dtype=pl.Boolean).alias("is_exposed"),
        pl.lit(None, dtype=pl.Int64).alias("nAA_24_180_pae"),
        pl.lit(None, dtype=pl.Float64).alias("nAA_24_180_pae_smooth10"),
        pl.lit(None, dtype=pl.Boolean).alias("is_idr"),
        pl.lit("unavailable").alias("mapping_status"),
    )
    frames = [unavailable] if matches is None else [matches, unavailable]
    return pl.concat(frames, how="diagonal_relaxed").sort(
        "protein_Id", "site", "fragment", nulls_last=True
    )


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
    """Apply the legacy pLDDT/CA-neighbor heuristic used by the older Python API.

    This is not the published Bludau calculation and is not used by ``prepare``.

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
