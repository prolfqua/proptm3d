"""Shared fixtures: synthetic AlphaFold-style PDB content and PTM tables."""

from pathlib import Path

import polars as pl
import pytest


def ca_line(
    serial: int, res3: str, res_num: int, x: float, y: float, z: float, plddt: float
) -> str:
    """Format one CA ATOM record in fixed-column PDB format."""
    return (
        f"ATOM  {serial:5d}  CA  {res3:>3} A{res_num:4d}    "
        f"{x:8.3f}{y:8.3f}{z:8.3f}{1.0:6.2f}{plddt:6.2f}"
    )


@pytest.fixture
def make_ca_line():
    """Expose the CA ATOM record formatter to tests."""
    return ca_line


@pytest.fixture
def pdb_text() -> str:
    """Four residues on a line, 10 Angstrom apart, with mixed pLDDT scores."""
    lines = [
        ca_line(1, "MET", 1, 0.0, 0.0, 0.0, 95.5),
        ca_line(2, "SER", 2, 10.0, 0.0, 0.0, 88.0),
        ca_line(3, "THR", 3, 20.0, 0.0, 0.0, 60.0),
        ca_line(4, "TYR", 4, 30.0, 0.0, 0.0, 40.0),
        "TER",
        "END",
    ]
    return "\n".join(lines) + "\n"


@pytest.fixture
def pdb_file(tmp_path: Path, pdb_text: str) -> Path:
    path = tmp_path / "P28482.pdb"
    path.write_text(pdb_text, encoding="utf-8")
    return path


@pytest.fixture
def ptm_frame() -> pl.DataFrame:
    """A prophosqua-style PTM results table for one protein, two contrasts."""
    return pl.DataFrame(
        {
            "protein_Id": ["sp|P28482|MK01_HUMAN"] * 3,
            "gene_name": ["MAPK1"] * 3,
            "posInProtein": [2, 3, 4],
            "modAA": ["S", "T", "Y"],
            "diff.site": [1.5, -2.0, 0.3],
            "FDR.site": [0.01, 0.2, 0.04],
            "contrast": ["A_vs_B", "A_vs_B", "C_vs_B"],
            "SequenceWindow": ["AASAA", "ATTAA", "AYYAA"],
        }
    )
