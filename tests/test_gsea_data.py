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
                        ]
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
    return {member.filename: hashlib.sha256(archive.read(member)).hexdigest() for member in members}


def test_gsea_terms_are_typed_and_keep_full_and_leading_members(tmp_path):
    path = _archive(tmp_path, _document())
    with ZipFile(path) as archive:
        members = gsea_data.archive_gsea_members(archive, "DPA")
        result = gsea_data.read_gsea_tables(archive, members, "DPA", _expected(archive, members))

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


def test_archive_members_select_current_json_results_by_method(tmp_path):
    path = _archive(tmp_path, _document())
    with ZipFile(path) as archive:
        dpa = gsea_data.archive_gsea_members(archive, "DPA")
        dpu = gsea_data.archive_gsea_members(archive, "DPU")

    assert [item.filename for item in dpa] == ["run/PTM_DPA/result_kinase_gsea.json.gz"]
    assert [item.filename for item in dpu] == ["run/PTM_DPU/result_kinase_gsea.json.gz"]


def test_gsea_archive_checksum_is_verified(tmp_path):
    path = _archive(tmp_path, _document())
    with ZipFile(path) as archive:
        members = gsea_data.archive_gsea_members(archive, "DPA")
        with pytest.raises(ValueError, match="checksum mismatch"):
            gsea_data.read_gsea_tables(
                archive,
                members,
                "DPA",
                {members[0].filename: "wrong"},
            )


def test_empty_gsea_document_produces_typed_empty_terms(tmp_path):
    path = _archive(tmp_path, _document({"data": {}}))
    with ZipFile(path) as archive:
        members = gsea_data.archive_gsea_members(archive, "DPA")
        result = gsea_data.read_gsea_tables(archive, members, "DPA", _expected(archive, members))

    assert result.terms.is_empty()
    assert result.terms.schema == gsea_data._TERM_SCHEMA
