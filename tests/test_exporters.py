"""Tests for the PyMOL exporter, the JSON data writer, and the standalone HTML export."""

import json

from ptm3d import data_loader, protein_data, pymol_exporter, structural_context, web_visualizer


def _standardized(ptm_frame, tmp_path):
    path = tmp_path / "results.csv"
    ptm_frame.write_csv(path)
    return data_loader.load_ptm_data(path)


def test_generate_pymol_script(tmp_path, pdb_file, ptm_frame):
    df = _standardized(ptm_frame, tmp_path)
    out = tmp_path / "out" / "MAPK1_pymol.pml"

    result = pymol_exporter.generate_pymol_script(pdb_file, df, out, protein_name="MAPK1")

    script = result.read_text(encoding="utf-8")
    assert f'load "{pdb_file.absolute()}", prot' in script
    for res_num in (2, 3, 4):
        assert f"show spheres, prot and resi {res_num}" in script
    # Labels only for FDR < 0.05: sites S2 (0.01) and Y4 (0.04), not T3 (0.2).
    assert 'label prot and resi 2 and name CA, "S2 (log2FC=+1.50)"' in script
    assert 'label prot and resi 4 and name CA, "Y4 (log2FC=+0.30)"' in script
    assert "label prot and resi 3" not in script


def test_fold_change_rgb():
    assert pymol_exporter._fold_change_rgb(2.0) == (1.0, 0.0, 0.0)
    assert pymol_exporter._fold_change_rgb(-2.0) == (0.0, 1.0, 0.0)
    assert pymol_exporter._fold_change_rgb(0.0) == (1.0, 1.0, 1.0)


def test_build_protein_payload(tmp_path, pdb_file, ptm_frame):
    df = _standardized(ptm_frame, tmp_path)
    res_df = structural_context.parse_pdb_residues(pdb_file)
    res_df = structural_context.calculate_ppse(res_df)

    payload = protein_data.build_protein_payload(
        df, res_df, protein_acc="P28482", gene_name="MAPK1", pdb_file="structures/P28482.pdb"
    )

    json.dumps(payload)  # Payload must be JSON-serializable.
    assert payload["gene_name"] == "MAPK1"
    assert payload["uniprot_acc"] == "P28482"
    assert payload["seq_len"] == 4
    assert payload["pdb_file"] == "structures/P28482.pdb"
    assert [p["res_num"] for p in payload["ptms"]] == [2, 3, 4]
    assert {p["contrast"] for p in payload["ptms"]} == {"A_vs_B", "C_vs_B"}
    # Residues covered by the structure carry coordinates and pLDDT.
    site = payload["ptms"][0]
    assert site["x"] == 10.0
    assert site["plddt"] == 88.0


def test_generate_interactive_html(tmp_path, pdb_file, ptm_frame):
    df = _standardized(ptm_frame, tmp_path)
    res_df = structural_context.parse_pdb_residues(pdb_file)
    res_df = structural_context.calculate_ppse(res_df)
    out = tmp_path / "out" / "MAPK1_P28482_3d.html"

    result = web_visualizer.generate_interactive_html(
        pdb_file, df, res_df, out, protein_acc="P28482", gene_name="MAPK1"
    )

    html = result.read_text(encoding="utf-8")
    assert "MAPK1" in html
    assert "P28482" in html
    assert '"res_num": 2' in html
    assert '<option value="A_vs_B">' in html
    assert '<option value="C_vs_B">' in html
    assert "ATOM" in html  # PDB content is embedded.
    assert '"color"' in html  # Records carry embedded colors.


def test_fold_change_hex():
    assert web_visualizer._fold_change_hex(0.0) == "#ffffff"
    assert web_visualizer._fold_change_hex(2.5).startswith("#ff")
    assert web_visualizer._fold_change_hex(-2.5)[3:5] == "ff"  # Down-regulated is green.


def test_write_protein_data_site_outside_structure(tmp_path, pdb_file, ptm_frame):
    df = _standardized(ptm_frame, tmp_path)
    res_df = structural_context.parse_pdb_residues(pdb_file)
    # Truncate the structure so residue 4 is not covered.
    res_df = res_df.head(3)

    records = protein_data.build_ptm_records(df, res_df, "P28482")

    uncovered = next(r for r in records if r["res_num"] == 4)
    assert uncovered["x"] is None
    assert uncovered["plddt"] is None
