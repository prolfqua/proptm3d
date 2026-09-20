"""Load string_gsea GSEAResult JSON files and distill the categories payload.

prophosqua writes one GSEAResult JSON per enrichment source (PTM-SEA,
kinase-library GSEA, MEA). Terms reference their member sites by canonical
upper-case sequence window; the association between sites and categories is
the N:M match on that window. This module merges those files and intersects
them with the loaded PTM table into the compact ``data/categories.*`` payload
the browser app renders: per contrast a window and protein index, and terms
holding index references plus site counts for both member modes (leading edge
and full mapped set).
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import polars as pl

from proptm3d.mudata_reader import read_mudata_enrichment


def load_gsea_results(
    paths: list[Path], analysis: str | int = "DPA"
) -> dict[str, dict[str, list[dict]]]:
    """Merge GSEAResult JSON files into ``contrast -> source -> terms``.

    Args:
        paths: GSEAResult JSON files or a completed MuData artifact.
        analysis: Analysis selected when reading MuData.

    Returns:
        Terms grouped by contrast and category (source) name.
    """
    merged: dict[str, dict[str, list[dict]]] = {}
    for path in paths:
        documents = _read_documents(Path(path), analysis)
        for doc in documents:
            for contrast, block in doc["data"].items():
                categories = merged.setdefault(contrast, {})
                for name, category in block["categories"].items():
                    categories.setdefault(name, []).extend(category["terms"])
    return merged


def _contrast_site_index(df: pl.DataFrame, contrast: str) -> dict[str, list[str]]:
    """Map each canonical window of one contrast to the accessions carrying it."""
    sites = (
        df.filter(pl.col("contrast") == contrast)
        .select("sequence_window", "uniprot_acc")
        .drop_nulls()
    )
    by_window: dict[str, list[str]] = defaultdict(list)
    for window, acc in sites.iter_rows():
        by_window[str(window).upper()].append(acc)
    return by_window


class _Indexer:
    """Assign stable indices to the windows/proteins a contrast's terms reference."""

    def __init__(self) -> None:
        self.values: list[str] = []
        self._index: dict[str, int] = {}

    def index(self, value: str) -> int:
        if value not in self._index:
            self._index[value] = len(self.values)
            self.values.append(value)
        return self._index[value]


def _term_entry(
    term: dict,
    source: str,
    site_index: dict[str, list[str]],
    catalog_accs: set[str],
    windows: _Indexer,
    proteins: _Indexer,
) -> dict:
    """Intersect one term with the dataset and encode it with index references."""
    entry: dict = {
        "term_id": term["term_id"],
        "source": source,
        "description": term["description"],
        "nes": term["enrichment_score"],
        "fdr": term["fdr"],
        "set_size": term["genes_in_set"],
    }
    for mode, ids in (("members", term["gene_ids"]), ("leading", term["leading_edge_ids"])):
        matched = [w for w in ids if w in site_index]
        accs = {acc for w in matched for acc in site_index[w]}
        catalog_hits = accs & catalog_accs
        entry[mode] = [windows.index(w) for w in matched]
        entry[f"{mode}_proteins"] = [proteins.index(acc) for acc in sorted(catalog_hits)]
        entry[f"{mode}_sites_total"] = sum(len(site_index[w]) for w in matched)
        entry[f"{mode}_sites_catalog"] = sum(
            1 for w in matched for acc in site_index[w] if acc in catalog_accs
        )
    return entry


def build_categories_payload(
    enrichment: dict[str, dict[str, list[dict]]],
    df: pl.DataFrame,
    catalog_accs: set[str],
) -> dict:
    """Build the ``data/categories.*`` payload from merged enrichment results.

    Member windows are intersected with the PTM table per contrast; windows and
    catalog accessions are stored once per contrast and referenced by index from
    the terms, which keeps the payload compact for large kinase sets.

    Args:
        enrichment: Merged terms from :func:`load_gsea_results`.
        df: The standardized PTM table of the whole run.
        catalog_accs: Accessions of the proteins processed into the catalog.

    Returns:
        The payload dict, ready for a ``PayloadWriter``.
    """
    contrasts: dict[str, dict] = {}
    sources: set[str] = set()
    for contrast, categories in enrichment.items():
        site_index = _contrast_site_index(df, contrast)
        windows = _Indexer()
        proteins = _Indexer()
        terms: list[dict] = []
        for source, source_terms in categories.items():
            sources.add(source)
            for term in source_terms:
                terms.append(_term_entry(term, source, site_index, catalog_accs, windows, proteins))
        terms.sort(key=lambda t: (t["fdr"] is None, t["fdr"]))
        contrasts[contrast] = {
            "windows": windows.values,
            "proteins": proteins.values,
            "terms": terms,
        }
    return {"sources": sorted(sources), "contrasts": contrasts}


def _read_documents(path: Path, analysis: str | int) -> list[dict]:
    readers = {
        ".h5mu": lambda: read_mudata_enrichment(path, analysis),
        ".json": lambda: [json.loads(path.read_text(encoding="utf-8"))],
    }
    return readers[path.suffix.lower()]()
