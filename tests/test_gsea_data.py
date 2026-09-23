"""Tests for completed GSEA stage artifact normalization."""

import gzip
import hashlib
import json
from zipfile import ZipFile

import cbor2
import pytest

from proptm3d import gsea_data


def _wrapper(**updates):
    document = json.dumps(
        {
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
    )
    wrapper = {
        "format": "prophosqua_stage",
        "version": "1.0.0",
        "stage": "KinaseGSEA",
        "analysis": "DPA",
        "statistics_sha256": "stats",
        "document": {
            "format": "string_gsea",
            "version": "1.2.0",
            "json": document,
            "sha256": hashlib.sha256(document.encode()).hexdigest(),
        },
    }
    wrapper.update(updates)
    return gzip.compress(cbor2.dumps(wrapper))


def _archive(tmp_path, payload):
    path = tmp_path / "delivery.zip"
    with ZipFile(path, "w") as archive:
        archive.writestr("run/PTM_DPA/result_kinase_gsea.cbor.gz", payload)
        archive.writestr("run/PTM_DPU/result_kinase_gsea.cbor.gz", payload)
        archive.writestr("run/PTM_DPA/unrelated.cbor.gz", payload)
    return path


def test_gsea_terms_are_typed_and_keep_full_and_leading_members(tmp_path):
    path = _archive(tmp_path, _wrapper())
    with ZipFile(path) as archive:
        members = gsea_data.archive_gsea_members(archive, "DPA")
        result = gsea_data.read_gsea_tables(archive, members, "DPA")

    assert len(members) == 1
    assert result.terms.select(
        "analysis", "contrast", "source", "term_id", "gene_ids", "leading_edge_ids"
    ).to_dicts() == [
        {
            "analysis": "DPA",
            "contrast": "a_vs_b",
            "source": "KinaseLib",
            "term_id": "ERK2",
            "gene_ids": ["AAAA", "BBBB"],
            "leading_edge_ids": ["BBBB"],
        }
    ]
    assert result.documents[0]["terms"] == 1


@pytest.mark.parametrize(
    ("updates", "message"),
    [
        ({"format": "unknown"}, "Unsupported GSEA artifact format"),
        ({"analysis": "DPU"}, "is for DPU, not DPA"),
        ({"document": {}}, "has no JSON document"),
    ],
)
def test_gsea_wrapper_validation(tmp_path, updates, message):
    path = _archive(tmp_path, _wrapper(**updates))
    with ZipFile(path) as archive, pytest.raises(ValueError, match=message):
        gsea_data.read_gsea_tables(archive, gsea_data.archive_gsea_members(archive, "DPA"), "DPA")


def test_gsea_document_checksum_is_verified(tmp_path):
    wrapper = cbor2.loads(gzip.decompress(_wrapper()))
    wrapper["document"]["sha256"] = "wrong"
    path = _archive(tmp_path, gzip.compress(cbor2.dumps(wrapper)))
    with ZipFile(path) as archive, pytest.raises(ValueError, match="checksum mismatch"):
        gsea_data.read_gsea_tables(archive, gsea_data.archive_gsea_members(archive, "DPA"), "DPA")


def test_empty_gsea_document_produces_typed_empty_terms(tmp_path):
    wrapper = cbor2.loads(gzip.decompress(_wrapper()))
    document = json.dumps({"data": {}})
    wrapper["document"]["json"] = document
    wrapper["document"]["sha256"] = hashlib.sha256(document.encode()).hexdigest()
    path = _archive(tmp_path, gzip.compress(cbor2.dumps(wrapper)))
    with ZipFile(path) as archive:
        result = gsea_data.read_gsea_tables(
            archive, gsea_data.archive_gsea_members(archive, "DPA"), "DPA"
        )
    assert result.terms.is_empty()
    assert result.terms.schema == gsea_data._TERM_SCHEMA
