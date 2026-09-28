"""Scenario 1 preparation preserves effects, all measured sites, and aligned evidence."""

import h5py
import numpy as np
import pytest

from proptm3d.prepared_data import _site_frame, read_prepared_tables


def _text(group, name, values):
    group.create_dataset(name, data=np.asarray(values, dtype=h5py.string_dtype()))


def _nullable_text(group, name, values):
    column = group.create_group(name)
    column.attrs["encoding-type"] = "nullable-string-array"
    _text(column, "values", ["" if value is None else value for value in values])
    column["mask"] = np.asarray([value is None for value in values], dtype=bool)


def _result_frame(handle, modality, key, row_ids, columns):
    frame = handle.require_group(f"mod/{modality}/varm").create_group(key)
    frame.attrs["encoding-type"] = "dataframe"
    _text(frame, "_index", row_ids)
    for name, values in columns.items():
        if all(value is None or isinstance(value, str) for value in values):
            _nullable_text(frame, name, values)
        else:
            frame[name] = np.asarray(values, dtype=float)


@pytest.fixture
def prepared_h5mu(tmp_path):
    path = tmp_path / "PTM_statistics.h5mu"
    protein = "sp|P12345|EXAMPLE_MOUSE"
    sites = ["P12345_S2~ASAA", "P12345_T4~AATA", "P12345_Y6~AAAY"]
    with h5py.File(path, "w") as handle:
        namespace = handle.create_group("uns/prophosqua")
        namespace["stage"] = "PTM_statistics"
        namespace["schema_version"] = "2.0.0"
        for modality in ("enriched", "enriched_CF", "total"):
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
                row_ids = [f"{protein}~lfq~{site}" for site in sites]
                _text(var, "_index", row_ids)
                _text(var, "protein_Id", ["P12345"] * 3)
                _text(var, "site", sites)
                _nullable_text(var, "fasta.id", [protein] * 3)
                _nullable_text(var, "gene_name", ["Example"] * 3)
                description = (
                    "CF protein OS=Mus musculus OX=10090"
                    if modality == "enriched_CF"
                    else "Example protein OS=Mus musculus OX=10090"
                )
                _nullable_text(var, "description", [description] * 3)
                _text(var, "modAA", ["S", "T", "Y"])
                _nullable_text(var, "SequenceWindow", ["ASAA", "AATA", "AAAY"])
                var["posInProtein"] = [2, 4, 6]
                var["protein_length"] = [7, 7, 7]
                group["X"] = (
                    [[1.0, 3.0, np.nan], [2.0, 4.0, np.nan]]
                    if modality == "enriched"
                    else [[-90.0, -70.0, np.nan], [-80.0, -60.0, np.nan]]
                )
                if modality == "enriched_CF":
                    layers = group.create_group("layers")
                    layers["correct_first_protein_imputed"] = [
                        [-9.0, -7.0, np.nan],
                        [-38.0, -36.0, np.nan],
                    ]

        dpa_columns = {
            "site": [sites[0], sites[1], None],
            "gene_name.site": ["Example", "Example", None],
            "estimate_type.site": ["observed", "lod_imputed", None],
            "estimate_type.protein": ["observed", "observed", None],
            "diff.site": [1.0, -2.0, np.nan],
            "diff.protein": [0.4, 0.4, np.nan],
            "FDR.site": [0.01, 0.1, np.nan],
            "p.value.site": [0.001, 0.02, np.nan],
            "std.error.site": [0.2, 0.3, np.nan],
        }
        _result_frame(handle, "enriched", "dpa__a_vs_b", row_ids, dpa_columns)
        _result_frame(
            handle,
            "enriched",
            "dpa__c_vs_d",
            row_ids,
            {
                **dpa_columns,
                "site": [sites[0], None, None],
                "estimate_type.site": ["observed", None, None],
                "estimate_type.protein": ["observed", None, None],
                "diff.site": [0.3, np.nan, np.nan],
                "diff.protein": [-0.1, np.nan, np.nan],
                "FDR.site": [0.2, np.nan, np.nan],
                "p.value.site": [0.05, np.nan, np.nan],
                "std.error.site": [0.4, np.nan, np.nan],
            },
        )
        dpu_columns = {
            **dpa_columns,
            "estimate_type.protein": ["lod_imputed", "observed", None],
            "diff_diff": [0.6, -2.4, np.nan],
            "FDR_I": [0.03, 0.2, np.nan],
            "pValue_I": [0.01, 0.1, np.nan],
            "SE_I": [0.5, 0.6, np.nan],
        }
        _result_frame(handle, "enriched", "dpu__a_vs_b", row_ids, dpu_columns)
        _result_frame(
            handle,
            "enriched",
            "dpu__c_vs_d",
            row_ids,
            {
                **dpu_columns,
                "site": [sites[0], None, None],
                "estimate_type.site": ["observed", None, None],
                "estimate_type.protein": ["observed", None, None],
                "diff_diff": [0.4, np.nan, np.nan],
                "FDR_I": [0.4, np.nan, np.nan],
                "pValue_I": [0.2, np.nan, np.nan],
                "SE_I": [0.7, np.nan, np.nan],
            },
        )
        cf_columns = {
            "site": [sites[0], sites[1], None],
            "estimate_type": ["observed", "lod_imputed", None],
            "diff.site": [1.0, -2.0, np.nan],
            "FDR.site": [0.05, 0.2, np.nan],
            "p.value": [0.01, 0.1, np.nan],
            "std.error": [0.3, 0.5, np.nan],
        }
        _result_frame(
            handle,
            "enriched_CF",
            "correct_first_protein_imputed__a_vs_b",
            row_ids,
            cf_columns,
        )
        _result_frame(
            handle,
            "enriched_CF",
            "correct_first_protein_imputed__c_vs_d",
            row_ids,
            {
                **cf_columns,
                "site": [sites[0], None, None],
                "estimate_type": ["observed", None, None],
                "diff.site": [0.2, np.nan, np.nan],
                "FDR.site": [0.3, np.nan, np.nan],
                "p.value": [0.2, np.nan, np.nan],
                "std.error": [0.6, np.nan, np.nan],
            },
        )
    return path


@pytest.mark.parametrize(("method", "effect"), [("DPA", 1.0), ("DPU", 0.6), ("CF-DPU", 1.0)])
def test_method_effects_and_all_measured_sites(prepared_h5mu, method, effect):
    tables = read_prepared_tables(prepared_h5mu, method)
    assert tables.contrasts == ["a_vs_b", "c_vs_d"]
    assert tables.sites.height == 3
    assert tables.proteins["detected_sites"].to_list() == [3]
    assert tables.proteins["measured_sites"].to_list() == [2]
    expected_description = (
        "CF protein OS=Mus musculus OX=10090"
        if method == "CF-DPU"
        else "Example protein OS=Mus musculus OX=10090"
    )
    assert tables.proteins["description"].to_list() == [expected_description]
    assert tables.stats["effect"][0] == effect
    assert tables.stats["original_site_fc"][0] == 1.0
    assert tables.stats["protein_fc"][0] == 0.4
    assert tables.stats["site"].to_list() == ["P12345_S2~ASAA", "P12345_S2~ASAA"]
    assert tables.stats["site_estimate_type"].unique().to_list() == ["observed"]
    assert tables.stats["imputed"].unique().to_list() == [False]


def test_dpu_keeps_observed_site_when_protein_estimate_was_imputed(prepared_h5mu):
    tables = read_prepared_tables(prepared_h5mu, "DPU")
    first = tables.stats.filter(tables.stats["contrast"].eq("a_vs_b"))
    assert first["protein_estimate_type"].to_list() == ["lod_imputed"]
    assert first["imputed"].to_list() == [False]


def test_sample_alignment_and_corrected_evidence(prepared_h5mu):
    dpa = read_prepared_tables(prepared_h5mu, "DPA")
    dpu = read_prepared_tables(prepared_h5mu, "DPU")
    cf = read_prepared_tables(prepared_h5mu, "CF-DPU")
    dpa_first = dpa.measurements.filter(dpa.measurements["site"].eq("P12345_S2~ASAA"))
    assert dpa_first["sample"].to_list() == ["a", "b"]
    assert dpa_first["protein_abundance"].to_list() == [30.0, 40.0]
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
        _text(var, "description", ["Example protein", "Casein alpha S2", "NA"])
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


def test_preparation_rejects_unsupported_mudata_schema(prepared_h5mu):
    with h5py.File(prepared_h5mu, "r+") as handle:
        handle["uns/prophosqua/schema_version"][()] = "1.0.0"
    with pytest.raises(ValueError, match="Unsupported prophosqua MuData schema"):
        read_prepared_tables(prepared_h5mu, "DPA")
