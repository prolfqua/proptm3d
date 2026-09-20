"""Tests for GSEAResult JSON loading and the categories payload."""

import json

import polars as pl

from proptm3d.enrichment_loader import build_categories_payload, load_gsea_results


def gsea_result_doc(source: str, terms: list[dict]) -> dict:
    return {
        "data": {
            "A_vs_B": {
                "contrast": "A_vs_B",
                "gene_pool": {},
                "categories": {source: {"category": source, "contrast": "A_vs_B", "terms": terms}},
            }
        },
        "rank_lists": {},
    }


def term(term_id: str, gene_ids: list[str], leading: list[str], fdr: float = 0.01) -> dict:
    return {
        "term_id": term_id,
        "category": "MEA",
        "description": term_id,
        "enrichment_score": -1.9,
        "direction": "bottom",
        "fdr": fdr,
        "method": "mea",
        "genes_mapped": len(gene_ids),
        "genes_in_set": len(gene_ids) + 1,
        "gene_ids": gene_ids,
        "leading_edge_ids": leading,
    }


def test_load_gsea_results_merges_sources_per_contrast(tmp_path):
    mea = tmp_path / "mea.json"
    mea.write_text(json.dumps(gsea_result_doc("MEA", [term("CDK2", ["AASAA"], ["AASAA"])])))
    ptmsea = tmp_path / "ptmsea.json"
    ptmsea.write_text(
        json.dumps(gsea_result_doc("PTM-SEA", [term("KINASE-PSP_CDK2", ["ATTAA"], [])]))
    )

    merged = load_gsea_results([mea, ptmsea])

    assert set(merged["A_vs_B"]) == {"MEA", "PTM-SEA"}
    assert merged["A_vs_B"]["MEA"][0]["term_id"] == "CDK2"


def test_build_categories_payload_intersects_windows_and_counts_sites():
    df = pl.DataFrame(
        {
            "uniprot_acc": ["P28482", "P28482", "Q00000"],
            "sequence_window": ["AASAA", "ATTAA", "AASAA"],  # Q00000: paralog window.
            "contrast": ["A_vs_B"] * 3,
        }
    )
    enrichment = {"A_vs_B": {"MEA": [term("CDK2", ["AASAA", "ATTAA", "ZZZZZ"], ["ATTAA"])]}}

    payload = build_categories_payload(enrichment, df, catalog_accs={"P28482"})

    assert payload["sources"] == ["MEA"]
    block = payload["contrasts"]["A_vs_B"]
    (entry,) = block["terms"]
    members = [block["windows"][i] for i in entry["members"]]
    assert set(members) == {"AASAA", "ATTAA"}  # ZZZZZ is not in the dataset.
    assert [block["windows"][i] for i in entry["leading"]] == ["ATTAA"]
    # AASAA occurs in two proteins, only one of them in the catalog.
    assert entry["members_sites_total"] == 3
    assert entry["members_sites_catalog"] == 2
    assert entry["leading_sites_total"] == 1
    assert entry["leading_sites_catalog"] == 1
    assert [block["proteins"][i] for i in entry["members_proteins"]] == ["P28482"]
    assert [block["proteins"][i] for i in entry["leading_proteins"]] == ["P28482"]
    assert entry["set_size"] == 4


def test_build_categories_payload_sorts_terms_by_fdr():
    df = pl.DataFrame(
        {
            "uniprot_acc": ["P28482"],
            "sequence_window": ["AASAA"],
            "contrast": ["A_vs_B"],
        }
    )
    enrichment = {
        "A_vs_B": {
            "MEA": [
                term("LATE", ["AASAA"], [], fdr=0.2),
                term("EARLY", ["AASAA"], [], fdr=0.001),
            ]
        }
    }

    payload = build_categories_payload(enrichment, df, catalog_accs={"P28482"})

    ids = [t["term_id"] for t in payload["contrasts"]["A_vs_B"]["terms"]]
    assert ids == ["EARLY", "LATE"]
