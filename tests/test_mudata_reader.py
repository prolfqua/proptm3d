"""Completed MuData supplies the same plot schema without delivery workbooks."""

import json

import h5py
import numpy as np
import pytest

from ptm3d.mudata_reader import read_mudata_enrichment, read_ptm_mudata


def _record(parent, name, values):
    group = parent.create_group(name)
    group.create_dataset("names", data=np.asarray(list(values), dtype=h5py.string_dtype()))
    for index, value in enumerate(values.values(), 1):
        column = group.create_group(f"items/item_{index:06d}")
        column.create_dataset(
            "storage", data="character" if isinstance(value[0], str) else "double"
        )
        column.create_dataset("values", data=value)
    return group


@pytest.fixture
def mudata_file(tmp_path):
    path = tmp_path / "PTM_results.h5mu"
    with h5py.File(path, "w") as handle:
        metadata = handle.create_group("uns/prophosqua")
        metadata["stage"] = "PTM_results"
        metadata["schema_version"] = "2.0.0"
        for modality, record, table in (
            ("enriched", "dpa_dpu", "combined_site_prot"),
            ("enriched", "dpa_dpu", "combined_test_diff"),
            ("cf", "report_data", "results"),
        ):
            group = handle.require_group(f"mod/{modality}/uns/prophosqua/{record}")
            if "names" in group:
                del group["names"]
                names = ["combined_site_prot", table]
            else:
                names = [table]
            group.create_dataset("names", data=names)
            frame = group.create_group(f"items/item_{len(names):06d}")
            _record(
                frame,
                "columns",
                {
                    "protein_Id": ["P12345"],
                    "site": ["P12345~S10"],
                    "contrast": ["a_vs_b"],
                    "posInProtein": [10.0],
                    "modAA": ["S"],
                    "SequenceWindow": ["AAAAAAASAAAAAAA"],
                    "gene_name.site": ["GENE"],
                    "diff.site": [1.0],
                    "FDR.site": [0.01],
                    "diff_diff": [2.0],
                    "FDR_I": [0.03],
                    "protein_length": [360.0],
                    "diff.protein": [0.4],
                    "estimate_type.site": ["lod_imputed"],
                },
            )
        docs = handle.create_group("mod/cf/uns/prophosqua/enrichment_documents")
        docs.create_group("MEA__CF")["json"] = json.dumps({"analysis": "CF"})
        docs.create_group("MEA__DPU")["json"] = json.dumps({"analysis": "DPU"})
    return path


@pytest.mark.parametrize(
    ("analysis", "effect", "fdr"), [("DPA", 1, 0.01), ("DPU", 2, 0.03), (2, 1, 0.01)]
)
def test_effect_columns_belong_to_requested_analysis(mudata_file, analysis, effect, fdr):
    table = read_ptm_mudata(mudata_file, analysis)
    assert table["diff.site"].to_list() == [effect]
    assert table["FDR.site"].to_list() == [fdr]
    assert table["gene_name"].to_list() == ["GENE"]
    assert table["protein_length"].to_list() == [360.0]
    assert table["diff.protein"].to_list() == [0.4]
    assert table["estimate_type.site"].to_list() == ["lod_imputed"]


def test_enrichment_is_selected_by_analysis(mudata_file):
    assert read_mudata_enrichment(mudata_file, "DPU") == [{"analysis": "DPU"}]
    assert read_mudata_enrichment(mudata_file, "DPA") == []


def test_incomplete_stage_and_unknown_schema_fail(mudata_file):
    with h5py.File(mudata_file, "r+") as handle:
        handle["uns/prophosqua/stage"][()] = "PTM_statistics"
    with pytest.raises(ValueError, match="completed"):
        read_ptm_mudata(mudata_file, "DPA")
    with h5py.File(mudata_file, "r+") as handle:
        handle["uns/prophosqua/stage"][()] = "PTM_results"
        handle["uns/prophosqua/schema_version"][()] = "unknown"
    with pytest.raises(ValueError, match="schema"):
        read_mudata_enrichment(mudata_file, "CF")
    with pytest.raises(ValueError, match="Unknown PTM analysis"):
        read_ptm_mudata(mudata_file, "invalid")


def test_missing_annotations_remain_missing(mudata_file):
    with h5py.File(mudata_file, "r+") as handle:
        column = handle[
            "mod/enriched/uns/prophosqua/dpa_dpu/items/item_000001/columns/items/item_000007"
        ]
        column["missing"] = [True]
    assert read_ptm_mudata(mudata_file, "DPA")["gene_name"].to_list() == [None]


def test_nullable_integer_positions_from_r(mudata_file):
    with h5py.File(mudata_file, "r+") as handle:
        column = handle[
            "mod/enriched/uns/prophosqua/dpa_dpu/items/item_000002/columns/items/item_000004"
        ]
        del column["values"]
        column["storage"][()] = "integer"
        nullable = column.create_group("values")
        nullable.attrs["encoding-type"] = "nullable-integer"
        nullable["values"] = [0]
        nullable["mask"] = [True]
    assert read_ptm_mudata(mudata_file, "DPU")["posInProtein"].to_list() == [None]
