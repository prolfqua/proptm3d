"""The shipped example table loads through the real column-alias mapping."""

from pathlib import Path

import polars as pl

from ptm3d import data_loader

EXAMPLE_CSV = Path(__file__).parent.parent / "examples" / "PTM_no_ERK_vs_ERK_top20.csv"


def test_example_csv_loads_and_standardizes():
    df = data_loader.load_ptm_data(EXAMPLE_CSV)

    assert set(df.columns) >= {
        "uniprot_acc",
        "pos_in_protein",
        "mod_aa",
        "log2fc",
        "fdr",
        "contrast",
        "gene_name",
    }
    assert df["uniprot_acc"].n_unique() == 20
    assert df.filter(pl.col("fdr") <= 0.05).height > 0
