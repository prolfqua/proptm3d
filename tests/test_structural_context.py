"""Tests for PDB parsing and residue-level structural annotations."""

import polars as pl
import pytest

from proptm3d import structural_context


def test_parse_pdb_residues(pdb_file):
    df = structural_context.parse_pdb_residues(pdb_file)

    assert df["res_num"].to_list() == [1, 2, 3, 4]
    assert df["res_aa"].to_list() == ["M", "S", "T", "Y"]
    assert df["plddt"].to_list() == [95.5, 88.0, 60.0, 40.0]
    assert df["x"].to_list() == [0.0, 10.0, 20.0, 30.0]


def test_parse_pdb_residues_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        structural_context.parse_pdb_residues(tmp_path / "absent.pdb")


def test_parse_pdb_residues_unknown_residue_and_duplicates(tmp_path, pdb_text, make_ca_line):
    text = pdb_text + make_ca_line(5, "XXX", 5, 40.0, 0.0, 0.0, 50.0) + "\n"
    text += make_ca_line(6, "ALA", 5, 41.0, 0.0, 0.0, 50.0) + "\n"  # Duplicate res_num 5.
    path = tmp_path / "dup.pdb"
    path.write_text(text, encoding="utf-8")

    df = structural_context.parse_pdb_residues(path)

    assert df["res_num"].to_list() == [1, 2, 3, 4, 5]
    assert df.filter(pl.col("res_num") == 5)["res_aa"][0] == "X"


def test_calculate_ppse_counts_neighbors_within_radius(pdb_file):
    df = structural_context.parse_pdb_residues(pdb_file)
    df = structural_context.calculate_ppse(df, radius=12.0)

    # Residues are 10 A apart on a line: ends have one neighbor, middles have two.
    assert df["ppse"].to_list() == [1, 2, 2, 1]


def test_calculate_ppse_empty_frame():
    empty = pl.DataFrame()
    assert structural_context.calculate_ppse(empty).is_empty()


def test_annotate_structural_regions(pdb_file):
    df = structural_context.parse_pdb_residues(pdb_file)
    df = structural_context.calculate_ppse(df)
    df = structural_context.annotate_structural_regions(df, plddt_window=1, ppse_window=1)

    assert df["is_idr"].to_list() == [False, False, True, True]
    assert df["is_deep_idr"].to_list() == [False, False, False, True]
    assert df["is_exposed"].all()  # Max neighbor count here is 2, below the threshold of 5.
