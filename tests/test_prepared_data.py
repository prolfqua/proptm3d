"""Scenario 1 preparation preserves effects, all measured sites, and aligned evidence."""

import h5py
import numpy as np
import pytest

from proptm3d.prepared_data import _site_frame, read_prepared_tables


def _text(group, name, values):
    group.create_dataset(name, data=np.asarray(values, dtype=h5py.string_dtype()))


def _record(parent, name, columns):
    item = parent.create_group(name)
    column_group = item.create_group("columns")
    _text(column_group, "names", list(columns))
    for index, (_column_name, values) in enumerate(columns.items(), 1):
        column = column_group.create_group(f"items/item_{index:06d}")
        text = any(isinstance(value, str) for value in values if value is not None)
        column["storage"] = "character" if text else "double"
        if text:
            _text(column, "values", [value or "" for value in values])
            column["missing"] = [value is None for value in values]
        else:
            column["values"] = [value if value is not None else np.nan for value in values]
    return item


@pytest.fixture
def prepared_h5mu(tmp_path):
    path = tmp_path / "PTM_statistics.h5mu"
    protein = "sp|P12345|EXAMPLE_MOUSE"
    sites = ["P12345_S2~ASAA", "P12345_T4~AATA", "P12345_Y6~AAAY"]
    with h5py.File(path, "w") as handle:
        namespace = handle.create_group("uns/prophosqua")
        namespace["stage"] = "PTM_statistics"
        namespace["schema_version"] = "2.0.0"
        for modality in ("enriched", "cf", "total"):
            group = handle.create_group(f"mod/{modality}")
            obs = group.create_group("obs")
            sample_order = ["b", "a"] if modality == "total" else ["a", "b"]
            _text(obs, "Name", sample_order)
            _text(obs, "G_", ["treatment" if x == "b" else "control" for x in sample_order])
            var = group.create_group("var")
            if modality == "total":
                _text(var, "protein_Id", [protein])
                group["X"] = [[40.0], [30.0]]
            else:
                _text(var, "protein_Id", ["P12345"] * 3)
                _text(var, "site", sites)
                _text(var, "fasta.id", [protein] * 3)
                _text(var, "gene_name", ["Example"] * 3)
                _text(var, "modAA", ["S", "T", "Y"])
                _text(var, "SequenceWindow", ["ASAA", "AATA", "AAAY"])
                var["posInProtein"] = [2, 4, 6]
                var["protein_length"] = [7, 7, 7]
                group["X"] = (
                    [[1.0, 3.0, np.nan], [2.0, 4.0, np.nan]]
                    if modality == "enriched"
                    else [[-9.0, -7.0, np.nan], [-38.0, -36.0, np.nan]]
                )
        dpa_dpu = handle.create_group("mod/enriched/uns/prophosqua/dpa_dpu")
        _text(dpa_dpu, "names", ["combined_site_prot", "combined_test_diff"])
        common = {
            "protein_Id": ["P12345", "P12345", "P12345"],
            "site": [sites[0], sites[1], sites[0]],
            "contrast": ["a_vs_b", "a_vs_b", "c_vs_d"],
            "posInProtein": [2.0, 4.0, 2.0],
            "modAA": ["S", "T", "S"],
            "SequenceWindow": ["ASAA", "AATA", "ASAA"],
            "gene_name.site": ["Example"] * 3,
            "protein_length": [7.0] * 3,
            "diff.site": [1.0, -2.0, 0.3],
            "diff.protein": [0.4, 0.4, -0.1],
            "estimate_type.site": ["observed", "lod_imputed", "observed"],
            "estimate_type.protein": ["observed"] * 3,
        }
        _record(
            dpa_dpu,
            "items/item_000001",
            common
            | {
                "FDR.site": [0.01, 0.1, 0.2],
                "p.value.site": [0.001, 0.02, 0.05],
                "std.error.site": [0.2, 0.3, 0.4],
            },
        )
        _record(
            dpa_dpu,
            "items/item_000002",
            common
            | {
                "diff_diff": [0.6, -2.4, 0.4],
                "FDR_I": [0.03, 0.2, 0.4],
                "pValue_I": [0.01, 0.1, 0.2],
                "SE_I": [0.5, 0.6, 0.7],
            },
        )
        report = handle.create_group("mod/cf/uns/prophosqua/report_data")
        _text(report, "names", ["results"])
        _record(
            report,
            "items/item_000001",
            {key: values[:2] for key, values in common.items()}
            | {
                "FDR.site": [0.05, 0.2],
                "p.value": [0.01, 0.1],
                "std.error": [0.3, 0.5],
                "estimate_type": ["observed", "lod_imputed"],
            },
        )
    return path


@pytest.mark.parametrize(("method", "effect"), [("DPA", 1.0), ("DPU", 0.6), ("CF-DPU", 1.0)])
def test_method_effects_and_all_measured_sites(prepared_h5mu, method, effect):
    tables = read_prepared_tables(prepared_h5mu, method)
    assert tables.contrasts == ["a_vs_b", "c_vs_d"] if method != "CF-DPU" else ["a_vs_b"]
    assert tables.sites.height == 3
    assert tables.proteins["detected_sites"].to_list() == [3]
    assert tables.proteins["measured_sites"].to_list() == [2]
    assert tables.stats["effect"][0] == effect
    assert tables.stats["original_site_fc"][0] == 1.0
    assert tables.stats["protein_fc"][0] == 0.4
    assert tables.stats.filter(tables.stats["site"].eq("P12345_T4~AATA"))["imputed"][0]


def test_sample_alignment_and_corrected_evidence(prepared_h5mu):
    dpu = read_prepared_tables(prepared_h5mu, "DPU")
    cf = read_prepared_tables(prepared_h5mu, "CF-DPU")
    first = dpu.measurements.filter(dpu.measurements["site"].eq("P12345_S2~ASAA"))
    assert first["sample"].to_list() == ["a", "b"]
    assert first["condition"].to_list() == ["control", "treatment"]
    assert first["site_abundance"].to_list() == [1.0, 2.0]
    assert first["protein_abundance"].to_list() == [30.0, 40.0]
    corrected = cf.measurements.filter(cf.measurements["site"].eq("P12345_S2~ASAA"))
    assert corrected["corrected_abundance"].to_list() == [-9.0, -38.0]


def test_site_catalog_keeps_contaminants_but_excludes_reverse_decoys(tmp_path):
    path = tmp_path / "catalog.h5"
    with h5py.File(path, "w") as handle:
        var = handle.create_group("mod/enriched/var")
        _text(var, "protein_Id", ["P12345", "P02663", "rev_A2ASS6"])
        _text(var, "site", ["P12345_S2", "P02663_S2", "rev_A2ASS6_S2"])
        _text(
            var,
            "fasta.id",
            [
                "sp|P12345|EXAMPLE_MOUSE",
                "contam_sp|P02663|CASA2_BOVIN",
                "NA",
            ],
        )
        _text(var, "gene_name", ["Example", "CASA2", "NA"])
        _text(var, "modAA", ["S", "S", "S"])
        _text(var, "SequenceWindow", ["ASAA"] * 3)
        var["posInProtein"] = [2, 2, 2]
        var["protein_length"] = [7, 7, 7]
        catalog = _site_frame(handle["mod/enriched"])
    assert catalog["accession"].to_list() == ["P12345", "P02663"]


def test_preparation_requires_statistics_stage(prepared_h5mu):
    with h5py.File(prepared_h5mu, "r+") as handle:
        handle["uns/prophosqua/stage"][()] = "PTM_results"
    with pytest.raises(ValueError, match="PTM_statistics"):
        read_prepared_tables(prepared_h5mu, "DPA")
