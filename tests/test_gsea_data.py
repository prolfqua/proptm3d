"""Tests for completed GSEA result-document normalization."""

import gzip
import hashlib
import json
from zipfile import ZipFile

import pytest

from proptm3d import gsea_data


def _document(data=None):
    document = data or {
        "data": {
            "a_vs_b": {
                "categories": {
                    "KinaseLib": {
                        "terms": [
                            {
                                "term_id": "ERK2",
                                "description": "ERK2",
                                "enrichment_score": -1.2,
                                "direction": "bottom",
                                "fdr": 0.02,
                                "method": "fgsea",
                                "genes_mapped": 2,
                                "genes_in_set": 4,
                                "gene_ids": ["AAAA", "BBBB"],
                                "leading_edge_ids": ["BBBB"],
                            }
                        ],
                        "gsea_result": {
                            "running_scores": {"ERK2": [0.0, -0.4, -1.2]},
                            "hit_indices": {"ERK2": [1, 2]},
                        },
                    }
                }
            }
        }
    }
    return gzip.compress(json.dumps(document, separators=(",", ":")).encode())


def _archive(tmp_path, payload):
    path = tmp_path / "delivery.zip"
    with ZipFile(path, "w") as archive:
        archive.writestr("run/PTM_DPA/result_kinase_gsea.json.gz", payload)
        archive.writestr("run/PTM_DPU/result_kinase_gsea.json.gz", payload)
        archive.writestr("run/PTM_DPA/unrelated.json.gz", payload)
    return path


def _expected(archive, members):
    return {member.filename: gsea_data.artifact_sha256(member) for member in members}


def test_gsea_terms_are_typed_and_keep_full_and_leading_members(tmp_path):
    path = _archive(tmp_path, _document())
    with ZipFile(path) as archive:
        members = gsea_data.archive_gsea_artifacts(archive, "DPA")
        result = gsea_data.read_gsea_tables(members, "DPA", _expected(archive, members))

    assert len(members) == 1
    assert result.terms.select(
        "analysis",
        "contrast",
        "source",
        "result_stage",
        "term_id",
        "gene_ids",
        "leading_edge_ids",
    ).to_dicts() == [
        {
            "analysis": "DPA",
            "contrast": "a_vs_b",
            "source": "KinaseLib",
            "result_stage": "KinaseGSEA",
            "term_id": "ERK2",
            "gene_ids": ["AAAA", "BBBB"],
            "leading_edge_ids": ["BBBB"],
        }
    ]
    assert result.documents[0]["format"] == "protsea-gsea-json"
    assert result.documents[0]["terms"] == 1
    assert result.curves.select(
        "term_id", "rank_indices", "running_scores", "hit_indices", "hit_scores"
    ).to_dicts() == [
        {
            "term_id": "ERK2",
            "rank_indices": [0, 1, 2],
            "running_scores": [0.0, -0.4, -1.2],
            "hit_indices": [1, 2],
            "hit_scores": [-0.4, -1.2],
        }
    ]


def test_gsea_document_streams_each_contrast(tmp_path):
    document = json.loads(gzip.decompress(_document()))
    document["data"]["c_vs_d"] = document["data"]["a_vs_b"]
    path = _archive(tmp_path, _document(document))
    with ZipFile(path) as archive:
        members = gsea_data.archive_gsea_artifacts(archive, "DPA")
        result = gsea_data.read_gsea_tables(members, "DPA", _expected(archive, members))

    assert result.terms["contrast"].to_list() == ["a_vs_b", "c_vs_d"]
    assert result.curves["contrast"].to_list() == ["a_vs_b", "c_vs_d"]


def test_archive_members_select_current_json_results_by_method(tmp_path):
    path = _archive(tmp_path, _document())
    with ZipFile(path) as archive:
        dpa = gsea_data.archive_gsea_artifacts(archive, "DPA")
        dpu = gsea_data.archive_gsea_artifacts(archive, "DPU")

    assert [item.filename for item in dpa] == ["PTM_DPA/result_kinase_gsea.json.gz"]
    assert [item.filename for item in dpu] == ["PTM_DPU/result_kinase_gsea.json.gz"]


def test_gsea_archive_checksum_is_verified(tmp_path):
    path = _archive(tmp_path, _document())
    with ZipFile(path) as archive:
        members = gsea_data.archive_gsea_artifacts(archive, "DPA")
        with pytest.raises(ValueError, match="checksum mismatch"):
            gsea_data.read_gsea_tables(
                members,
                "DPA",
                {members[0].filename: "wrong"},
            )


def test_empty_gsea_document_produces_typed_empty_terms(tmp_path):
    path = _archive(tmp_path, _document({"data": {}}))
    with ZipFile(path) as archive:
        members = gsea_data.archive_gsea_artifacts(archive, "DPA")
        result = gsea_data.read_gsea_tables(members, "DPA", _expected(archive, members))

    assert result.terms.is_empty()
    assert result.terms.schema == gsea_data._TERM_SCHEMA
    assert result.curves.is_empty()
    assert result.curves.schema == gsea_data._CURVE_SCHEMA


def test_folder_artifacts_use_the_same_reader(tmp_path):
    folder = tmp_path / "delivery"
    method = folder / "PTM_DPA"
    method.mkdir(parents=True)
    payload = _document()
    artifact_path = method / "result_kinase_gsea.json.gz"
    artifact_path.write_bytes(payload)
    artifacts = gsea_data.folder_gsea_artifacts(folder, "DPA")

    result = gsea_data.read_gsea_tables(
        artifacts,
        "DPA",
        {artifacts[0].filename: hashlib.sha256(payload).hexdigest()},
    )

    assert [artifact.filename for artifact in artifacts] == ["PTM_DPA/result_kinase_gsea.json.gz"]
    assert result.terms["term_id"].to_list() == ["ERK2"]


def test_running_curves_are_compacted_with_exact_rank_and_hit_coordinates():
    scores = [index / 3000 for index in range(3000)]
    row = gsea_data._compact_curve({"running_scores": scores, "hit_indices": [17, 2999]})

    assert len(row["running_scores"]) <= 2000
    assert row["rank_indices"][0] == 0
    assert row["rank_indices"][-1] == 2999
    assert scores.index(min(scores)) in row["rank_indices"]
    assert scores.index(max(scores)) in row["rank_indices"]
    assert row["hit_scores"] == [scores[17], scores[2999]]
