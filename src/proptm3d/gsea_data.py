"""Read completed prophosqua GSEA stage artifacts into Parquet-ready tables."""

from __future__ import annotations

import gzip
import hashlib
import tempfile
from dataclasses import dataclass
from zipfile import ZipFile, ZipInfo

import cbor2
import ijson
import polars as pl

GSEA_RESULT_FILES = (
    "result_ptm_sea.cbor.gz",
    "result_kinase_gsea.cbor.gz",
    "result_mea.cbor.gz",
)
METHOD_DIRECTORIES = {
    "DPA": "PTM_DPA",
    "DPU": "PTM_DPU",
    "CF-DPU": "PTM_CF_DPU",
}
_WRAPPER_ANALYSIS = {"DPA": "DPA", "DPU": "DPU", "CF-DPU": "CF"}
_TERM_SCHEMA = {
    "analysis": pl.String,
    "contrast": pl.String,
    "source": pl.String,
    "result_stage": pl.String,
    "term_id": pl.String,
    "description": pl.String,
    "enrichment_score": pl.Float64,
    "direction": pl.String,
    "fdr": pl.Float64,
    "method": pl.String,
    "genes_mapped": pl.Int64,
    "genes_in_set": pl.Int64,
    "gene_ids": pl.List(pl.String),
    "leading_edge_ids": pl.List(pl.String),
}
_TERM_FIELDS = set(_TERM_SCHEMA) - {
    "analysis",
    "contrast",
    "source",
    "result_stage",
    "gene_ids",
    "leading_edge_ids",
}


@dataclass(slots=True)
class GseaTables:
    """Normalized GSEA terms plus source-document provenance."""

    terms: pl.DataFrame
    documents: list[dict]


def archive_gsea_members(archive: ZipFile, method: str) -> list[ZipInfo]:
    """Find recognized GSEA result artifacts for one method in a delivery ZIP."""
    directory = METHOD_DIRECTORIES[method]
    expected = set(GSEA_RESULT_FILES)
    return [
        member
        for member in archive.infolist()
        if not member.is_dir()
        and len(parts := member.filename.split("/")) >= 2
        and parts[-2] == directory
        and parts[-1] in expected
    ]


def _term_rows(document: str, analysis: str, result_stage: str) -> list[dict]:
    rows = []
    contrast = ""
    source = ""
    term: dict | None = None
    with tempfile.TemporaryFile() as stream:
        for start in range(0, len(document), 1024 * 1024):
            stream.write(document[start : start + 1024 * 1024].encode())
        stream.seek(0)
        for prefix, event, value in ijson.parse(stream, use_float=True):
            if prefix == "data" and event == "map_key":
                contrast = value
            elif prefix.endswith(".categories") and event == "map_key":
                source = value
            elif prefix.endswith(".terms.item") and event == "start_map":
                term = {
                    "analysis": analysis,
                    "contrast": contrast,
                    "source": source,
                    "result_stage": result_stage,
                    "gene_ids": [],
                    "leading_edge_ids": [],
                }
            elif term is not None and prefix.endswith(".terms.item") and event == "end_map":
                rows.append(term)
                term = None
            elif term is not None and event in {"string", "number", "null", "boolean"}:
                field = prefix.rsplit(".", 1)[-1]
                if field == "item":
                    list_name = prefix.rsplit(".", 2)[-2]
                    if list_name in {"gene_ids", "leading_edge_ids"}:
                        term[list_name].append(value)
                elif field in _TERM_FIELDS:
                    term[field] = value
    return rows


def _read_result(archive: ZipFile, member: ZipInfo, method: str) -> tuple[list[dict], dict]:
    with archive.open(member) as compressed, gzip.GzipFile(fileobj=compressed) as stream:
        wrapper = cbor2.load(stream)
    if wrapper.get("format") != "prophosqua_stage":
        msg = f"Unsupported GSEA artifact format in {member.filename}"
        raise ValueError(msg)
    expected_analysis = _WRAPPER_ANALYSIS[method]
    if wrapper.get("analysis") != expected_analysis:
        msg = (
            f"GSEA artifact {member.filename} is for {wrapper.get('analysis')}, "
            f"not {expected_analysis}"
        )
        raise ValueError(msg)
    payload = wrapper.get("document", {})
    document = payload.get("json")
    if not isinstance(document, str):
        msg = f"GSEA artifact {member.filename} has no JSON document"
        raise ValueError(msg)
    digest = hashlib.sha256(document.encode()).hexdigest()
    if digest != payload.get("sha256"):
        msg = f"GSEA artifact checksum mismatch: {member.filename}"
        raise ValueError(msg)
    stage = wrapper.get("stage")
    rows = _term_rows(document, method, stage)
    provenance = {
        "file": member.filename,
        "stage": stage,
        "format": payload.get("format"),
        "version": payload.get("version"),
        "sha256": digest,
        "statistics_sha256": wrapper.get("statistics_sha256"),
        "terms": len(rows),
    }
    return rows, provenance


def read_gsea_tables(archive: ZipFile, members: list[ZipInfo], method: str) -> GseaTables:
    """Read selected delivery artifacts into one typed term table."""
    rows = []
    documents = []
    for member in sorted(members, key=lambda item: item.filename):
        result_rows, provenance = _read_result(archive, member, method)
        rows.extend(result_rows)
        documents.append(provenance)
    terms = pl.DataFrame(rows, schema=_TERM_SCHEMA) if rows else pl.DataFrame(schema=_TERM_SCHEMA)
    return GseaTables(terms, documents)
