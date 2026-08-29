"""Tests for the PTM table loader and schema standardization."""

import polars as pl
import pytest

from ptm3d import data_loader


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("sp|P28482|MK01_HUMAN", "P28482"),
        ("tr|A0A024R5Z9|A0A024R5Z9_HUMAN", "A0A024R5Z9"),
        ("P28482", "P28482"),
        ("P28482-2", "P28482-2"),
        ("weird|Q12345|rest", "Q12345"),
        ("not-an-accession", "not-an-accession"),
    ],
)
def test_parse_uniprot_accession(value, expected):
    assert data_loader.parse_uniprot_accession(value) == expected


def test_parse_uniprot_accession_missing_value():
    assert data_loader.parse_uniprot_accession(None) is None
    assert data_loader.parse_uniprot_accession(float("nan")) is None


def test_load_ptm_data_csv(tmp_path, ptm_frame):
    path = tmp_path / "results.csv"
    ptm_frame.write_csv(path)

    df = data_loader.load_ptm_data(path)

    assert set(df.columns) >= {"uniprot_acc", "pos_in_protein", "mod_aa", "log2fc", "fdr"}
    assert df["uniprot_acc"].unique().to_list() == ["P28482"]
    assert df["pos_in_protein"].to_list() == [2, 3, 4]
    assert df["log2fc"].to_list() == [1.5, -2.0, 0.3]


def test_load_ptm_data_tsv_and_xlsx(tmp_path, ptm_frame):
    tsv_path = tmp_path / "results.tsv"
    ptm_frame.write_csv(tsv_path, separator="\t")
    xlsx_path = tmp_path / "results.xlsx"
    ptm_frame.write_excel(xlsx_path)

    for path in (tsv_path, xlsx_path):
        df = data_loader.load_ptm_data(path)
        assert df["uniprot_acc"].unique().to_list() == ["P28482"]


def test_load_ptm_data_accepts_string_path(tmp_path, ptm_frame):
    path = tmp_path / "results.csv"
    ptm_frame.write_csv(path)
    df = data_loader.load_ptm_data(str(path))
    assert not df.is_empty()


def test_load_ptm_data_unsupported_extension(tmp_path):
    path = tmp_path / "results.parquet"
    path.write_text("junk", encoding="utf-8")
    with pytest.raises(ValueError, match="Unsupported file format"):
        data_loader.load_ptm_data(path)


def test_load_ptm_data_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        data_loader.load_ptm_data(tmp_path / "absent.csv")


def test_load_ptm_data_missing_protein_column(tmp_path):
    path = tmp_path / "results.csv"
    pl.DataFrame({"posInProtein": [1]}).write_csv(path)
    with pytest.raises(KeyError, match="protein identifier"):
        data_loader.load_ptm_data(path)


def test_load_ptm_data_coerces_bad_numbers(tmp_path, ptm_frame):
    frame = ptm_frame.with_columns(pl.Series("posInProtein", ["not-a-number", "3", "4"]))
    path = tmp_path / "results.csv"
    frame.write_csv(path)

    df = data_loader.load_ptm_data(path)

    assert df["pos_in_protein"][0] is None
    assert df["pos_in_protein"][1] == 3


def test_filter_ptm_data(tmp_path, ptm_frame):
    path = tmp_path / "results.csv"
    ptm_frame.write_csv(path)
    df = data_loader.load_ptm_data(path)

    by_contrast = data_loader.filter_ptm_data(df, contrast="A_vs_B")
    assert by_contrast.height == 2

    by_fdr = data_loader.filter_ptm_data(df, min_fdr=0.05)
    assert by_fdr["fdr"].max() <= 0.05

    by_protein = data_loader.filter_ptm_data(df, protein_acc="NOPE")
    assert by_protein.is_empty()
