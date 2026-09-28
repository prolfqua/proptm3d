"""Read completed prophosqua GSEA stage artifacts into Parquet-ready tables."""

from __future__ import annotations

import gzip
import hashlib
from dataclasses import dataclass
from typing import BinaryIO
from zipfile import ZipFile, ZipInfo

import ijson
import polars as pl

GSEA_RESULT_FILES = (
    "result_ptm_sea.json.gz",
    "result_kinase_gsea.json.gz",
    "result_mea.json.gz",
)
RESULT_STAGES = {
    "result_ptm_sea.json.gz": "PTMSEA",
    "result_kinase_gsea.json.gz": "KinaseGSEA",
    "result_mea.json.gz": "MEA",
}
METHOD_DIRECTORIES = {
    "DPA": "PTM_DPA",
    "DPU": "PTM_DPU",
    "CF-DPU": "PTM_CF_DPU",
}
H5_ANALYSES = {"DPA": "DPA", "DPU": "DPU", "CF-DPU": "CF"}
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


def artifact_key(method: str, member: ZipInfo) -> str:
    """Return the PTM_results metadata key for a result archive member."""
    return f"{RESULT_STAGES[member.filename.rsplit('/', 1)[-1]]}__{H5_ANALYSES[method]}"


def _term_rows(stream: BinaryIO, analysis: str, result_stage: str) -> list[dict]:
    rows = []
    contrast = ""
    source = ""
    term: dict | None = None
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


def _member_sha256(archive: ZipFile, member: ZipInfo) -> str:
    digest = hashlib.sha256()
    with archive.open(member) as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _read_result(
    archive: ZipFile,
    member: ZipInfo,
    method: str,
    expected_sha256: str,
) -> tuple[list[dict], dict]:
    digest = _member_sha256(archive, member)
    if digest != expected_sha256:
        msg = f"GSEA artifact checksum mismatch: {member.filename}"
        raise ValueError(msg)
    stage = RESULT_STAGES[member.filename.rsplit("/", 1)[-1]]
    with archive.open(member) as compressed, gzip.GzipFile(fileobj=compressed) as stream:
        rows = _term_rows(stream, method, stage)
    provenance = {
        "file": member.filename,
        "stage": stage,
        "format": "protsea-gsea-json",
        "sha256": digest,
        "terms": len(rows),
    }
    return rows, provenance


def read_gsea_tables(
    archive: ZipFile,
    members: list[ZipInfo],
    method: str,
    expected_sha256: dict[str, str],
) -> GseaTables:
    """Read selected delivery artifacts into one typed term table."""
    rows = []
    documents = []
    for member in sorted(members, key=lambda item: item.filename):
        result_rows, provenance = _read_result(
            archive,
            member,
            method,
            expected_sha256[member.filename],
        )
        rows.extend(result_rows)
        documents.append(provenance)
    terms = pl.DataFrame(rows, schema=_TERM_SCHEMA) if rows else pl.DataFrame(schema=_TERM_SCHEMA)
    return GseaTables(terms, documents)
