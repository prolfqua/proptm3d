"""Tests for PDB parsing and residue-level structural annotations."""

import gzip
import json

import numpy as np
import polars as pl
import pytest

from proptm3d import structural_context


def _coordinate_frame() -> pl.DataFrame:
    return pl.DataFrame(
        {
            "model_position": [1, 2, 3],
            "position": [11, 12, 13],
            "residue": ["A", "S", "T"],
            "plddt": [90.0, 80.0, 70.0],
            "ca_x": [0.0, 4.0, 8.0],
            "ca_y": [0.0, 0.0, 0.0],
            "ca_z": [0.0, 0.0, 0.0],
            "cb_x": [1.0, 5.0, 9.0],
            "cb_y": [0.0, 0.0, 0.0],
            "cb_z": [0.0, 0.0, 0.0],
            "c_x": [0.0, 4.0, 8.0],
            "c_y": [1.0, 1.0, 1.0],
            "c_z": [0.0, 0.0, 0.0],
            "n_x": [0.0, 4.0, 8.0],
            "n_y": [-1.0, -1.0, -1.0],
            "n_z": [0.0, 0.0, 0.0],
        }
    )


def _alphafold_cif_text() -> str:
    return """data_test
loop_
_atom_site.group_PDB
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_seq_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.B_iso_or_equiv
_atom_site.pdbx_sifts_xref_db_num
_atom_site.pdbx_sifts_xref_db_res
ATOM N  ALA A 1 0 0 0 91 11 A
ATOM CA ALA A 1 1 0 0 91 11 A
ATOM C  ALA A 1 1 1 0 91 11 A
ATOM CB ALA A 1 2 0 0 91 11 A
ATOM N  GLY A 2 3 0 0 72 12 G
ATOM CA GLY A 2 4 0 0 72 12 G
ATOM C  GLY A 2 4 1 0 72 12 G
#
"""


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


def test_parse_alphafold_cif_reads_global_positions_and_missing_gly_cb(tmp_path):
    path = tmp_path / "AF-P12345-F1-model_v6.cif.gz"
    with gzip.open(path, "wt", encoding="utf-8") as stream:
        stream.write(_alphafold_cif_text())

    residues = structural_context.parse_alphafold_cif(path)

    assert residues["model_position"].to_list() == [1, 2]
    assert residues["position"].to_list() == [11, 12]
    assert residues["residue"].to_list() == ["A", "G"]
    assert residues["plddt"].to_list() == [91.0, 72.0]
    assert residues["cb_x"].to_list() == [2.0, None]


def test_model_context_cache_computes_gly_vector_and_reuses_result(tmp_path):
    structures = tmp_path / "alphafold" / "structures"
    structures.mkdir(parents=True)
    model_file = "AF-P12345-F1-model_v6.cif.gz"
    with gzip.open(structures / model_file, "wt", encoding="utf-8") as stream:
        stream.write(_alphafold_cif_text())
    pae_file = tmp_path / "pae.json.gz"
    with gzip.open(pae_file, "wt", encoding="utf-8") as stream:
        json.dump([{"predicted_aligned_error": [[0, 0], [0, 0]]}], stream)
    models = {
        "P12345": [
            {
                "file": model_file,
                "model_id": "AF-P12345-F1",
                "fragment": 1,
                "version": 6,
                "start": 1,
            }
        ]
    }

    cached = structural_context.cache_model_contexts(models, {model_file: pae_file}, tmp_path)

    result = pl.read_parquet(cached[model_file])
    assert result["position"].to_list() == [11, 12]
    assert result["nAA_24_180_pae"].to_list() == [1, 1]
    (structures / model_file).unlink()
    pae_file.unlink()
    assert structural_context.cache_model_contexts(models, {}, tmp_path) == cached


def test_structural_context_validates_files_shapes_and_columns(tmp_path):
    with pytest.raises(FileNotFoundError, match="mmCIF"):
        structural_context.parse_alphafold_cif(tmp_path / "missing.cif")

    plain_cif = tmp_path / "model.cif"
    plain_cif.write_text(_alphafold_cif_text())
    assert structural_context.parse_alphafold_cif(plain_cif).height == 2

    plain_pae = tmp_path / "pae.json"
    plain_pae.write_text(json.dumps({"predicted_aligned_error": [[0, 1], [2, 0]]}))
    pae = structural_context.load_pae(plain_pae)
    assert pae.shape == (2, 2)
    assert pae.dtype == np.uint8
    plain_pae.write_text(json.dumps({"predicted_aligned_error": [[0, 1]]}))
    with pytest.raises(ValueError, match="square"):
        structural_context.load_pae(plain_pae)

    with pytest.raises(ValueError, match="lacks structural columns"):
        structural_context.annotate_bludau_context(
            pl.DataFrame({"position": [1]}), np.zeros((1, 1))
        )
    with pytest.raises(ValueError, match="do not fit PAE"):
        structural_context.annotate_bludau_context(_coordinate_frame(), np.zeros((2, 2)))


def test_empty_structural_inputs_remain_explicitly_unavailable(tmp_path):
    empty_residues = _coordinate_frame().clear()
    assert structural_context.annotate_bludau_context(empty_residues, np.zeros((0, 0))).is_empty()
    empty_context = tmp_path / "empty.parquet"
    pl.DataFrame(schema={"accession": pl.String}).write_parquet(empty_context)
    sites = pl.DataFrame(
        {
            "protein_Id": ["P12345"],
            "site": ["P12345_S12"],
            "accession": ["P12345"],
            "posInProtein": [12],
            "modAA": ["S"],
            "has_measurement": [True],
        }
    )

    output = structural_context.site_structural_context(sites, {"empty": empty_context})

    assert output["mapping_status"].to_list() == ["unavailable"]


def test_bludau_context_uses_directed_pae_part_sphere_and_published_idr_cutoff():
    pae = np.zeros((3, 3))
    pae[0, 2] = 5.0  # 8 A coordinate distance + 5 A PAE exceeds the 12 A pPSE cutoff.

    annotated = structural_context.annotate_bludau_context(_coordinate_frame(), pae)

    assert annotated["nAA_12_70_pae"].to_list() == [1, 1, 0]
    assert annotated["nAA_24_180_pae"].to_list() == [2, 2, 2]
    assert annotated["nAA_24_180_pae_smooth10"].to_list() == [2.0, 2.0, 2.0]
    assert annotated["is_exposed"].to_list() == [True, True, True]
    assert annotated["is_idr"].to_list() == [True, True, True]


def test_site_context_preserves_overlapping_models_and_unavailable_sites(tmp_path):
    base = structural_context.annotate_bludau_context(_coordinate_frame(), np.zeros((3, 3)))
    paths = {}
    for fragment, residue in ((1, "S"), (2, "A")):
        path = tmp_path / f"fragment-{fragment}.parquet"
        base.filter(pl.col("position") == 12).with_columns(
            pl.lit("P12345").alias("accession"),
            pl.lit(f"AF-P12345-F{fragment}").alias("model_id"),
            pl.lit(fragment).alias("fragment"),
            pl.lit(6).alias("version"),
            pl.lit(residue).alias("residue"),
        ).write_parquet(path)
        paths[str(fragment)] = path
    sites = pl.DataFrame(
        {
            "protein_Id": ["P12345", "P12345"],
            "site": ["P12345_S12", "P12345_T99"],
            "accession": ["P12345", "P12345"],
            "posInProtein": [12, 99],
            "modAA": ["S", "T"],
            "has_measurement": [True, True],
        }
    )

    matched = structural_context.site_structural_context(sites, paths)

    assert matched.height == 3
    assert matched.filter(pl.col("site") == "P12345_S12")["mapping_status"].to_list() == [
        "matched",
        "residue_mismatch",
    ]
    assert matched.filter(pl.col("site") == "P12345_T99")["mapping_status"].to_list() == [
        "unavailable"
    ]
