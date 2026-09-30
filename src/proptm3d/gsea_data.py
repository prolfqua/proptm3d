"""Read completed prophosqua GSEA artifacts into Parquet-ready tables."""

from __future__ import annotations

import gzip
import hashlib
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import BinaryIO
from zipfile import ZipFile

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
RESULT_LABELS = {"PTMSEA": "PTM-SEA", "KinaseGSEA": "Kinase GSEA", "MEA": "MEA"}
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
_CURVE_SCHEMA = {
    "analysis": pl.String,
    "contrast": pl.String,
    "source": pl.String,
    "result_stage": pl.String,
    "term_id": pl.String,
    "rank_indices": pl.List(pl.Int64),
    "running_scores": pl.List(pl.Float64),
    "hit_indices": pl.List(pl.Int64),
    "hit_scores": pl.List(pl.Float64),
}
_RANK_SCHEMA = {
    "analysis": pl.String,
    "contrast": pl.String,
    "result_stage": pl.String,
    "sequence_window": pl.String,
    "rank": pl.Int64,
}
_TERM_FIELDS = set(_TERM_SCHEMA) - {
    "analysis",
    "contrast",
    "source",
    "result_stage",
    "gene_ids",
    "leading_edge_ids",
}


@dataclass(frozen=True, slots=True)
class GseaArtifact:
    """One GSEA document with a source-independent stream opener."""

    filename: str
    open_stream: Callable[[], BinaryIO]

    @property
    def name(self) -> str:
        """Return the result-document basename."""
        return self.filename.rsplit("/", 1)[-1]


@dataclass(slots=True)
class GseaTables:
    """Normalized GSEA terms, enrichment curves, and source provenance."""

    terms: pl.DataFrame
    curves: pl.DataFrame
    ranks: pl.DataFrame
    documents: list[dict]


@dataclass(slots=True)
class GseaInput:
    """Validated artifact references consumed one contrast at a time."""

    artifacts: list[GseaArtifact]
    expected_sha256: dict[str, str]
    documents: list[dict] = field(default_factory=list)


def archive_gsea_artifacts(archive: ZipFile, method: str) -> list[GseaArtifact]:
    """Find recognized GSEA result artifacts for one method in a delivery ZIP."""
    directory = METHOD_DIRECTORIES[method]
    expected = set(GSEA_RESULT_FILES)
    return [
        GseaArtifact("/".join(parts[-2:]), lambda member=member: archive.open(member))
        for member in archive.infolist()
        if not member.is_dir()
        and len(parts := member.filename.split("/")) >= 2
        and parts[-2] == directory
        and parts[-1] in expected
    ]


def folder_gsea_artifacts(directory: Path, method: str) -> list[GseaArtifact]:
    """Find recognized GSEA result artifacts in one unpacked delivery folder."""
    method_dir = directory / METHOD_DIRECTORIES[method]
    return [
        GseaArtifact(
            path.relative_to(directory).as_posix(),
            lambda path=path: path.open("rb"),
        )
        for name in GSEA_RESULT_FILES
        if (path := method_dir / name).is_file()
    ]


def artifact_key(method: str, artifact: GseaArtifact) -> str:
    """Return the PTM_results metadata key for a result artifact."""
    return f"{RESULT_STAGES[artifact.name]}__{H5_ANALYSES[method]}"


def _document_rows(  # noqa: C901
    stream: BinaryIO, analysis: str, result_stage: str
) -> Iterator[tuple[list[dict], list[dict], list[dict]]]:
    terms = []
    ranks = []
    curves: dict[tuple[str, str, str], dict] = {}
    contrast = ""
    source = ""
    term: dict | None = None
    curve_prefix = ""
    curve_key: tuple[str, str, str] | None = None
    curve_field = ""
    for prefix, event, value in ijson.parse(stream, use_float=True):
        if prefix == "data" and event == "map_key":
            if contrast:
                yield terms, list(curves.values()), ranks
                terms = []
                ranks = []
                curves = {}
            contrast = value
            source = ""
        elif prefix.startswith(f"data.{contrast}.gene_pool.") and prefix.endswith(".rank"):
            if event == "number":
                ranks.append(
                    {
                        "analysis": analysis,
                        "contrast": contrast,
                        "result_stage": result_stage,
                        "sequence_window": prefix[len(f"data.{contrast}.gene_pool.") : -5].upper(),
                        "rank": value,
                    }
                )
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
            terms.append(term)
            term = None
        elif term is not None and event in {"string", "number", "null", "boolean"}:
            field = prefix.rsplit(".", 1)[-1]
            if field == "item":
                list_name = prefix.rsplit(".", 2)[-2]
                if list_name in {"gene_ids", "leading_edge_ids"}:
                    term[list_name].append(value)
            elif field in _TERM_FIELDS:
                term[field] = value
        if event == "map_key" and prefix.endswith(".gsea_result.running_scores"):
            curve_prefix = f"{prefix}.{value}"
            curve_key = (contrast, source, value)
            curve_field = "running_scores"
        elif event == "map_key" and prefix.endswith(".gsea_result.hit_indices"):
            curve_prefix = f"{prefix}.{value}"
            curve_key = (contrast, source, value)
            curve_field = "hit_indices"
        elif curve_key is not None and prefix == f"{curve_prefix}.item" and event == "number":
            row = curves.setdefault(
                curve_key,
                {
                    "analysis": analysis,
                    "contrast": curve_key[0],
                    "source": curve_key[1],
                    "result_stage": result_stage,
                    "term_id": curve_key[2],
                    "running_scores": [],
                    "hit_indices": [],
                },
            )
            row[curve_field].append(value)
    if contrast:
        yield terms, list(curves.values()), ranks


def artifact_sha256(artifact: GseaArtifact) -> str:
    """Hash a GSEA artifact without retaining its compressed bytes."""
    digest = hashlib.sha256()
    with artifact.open_stream() as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _compact_curve(row: dict, max_points: int = 2000) -> dict:
    scores = row["running_scores"]
    if any(rank < 1 or rank > len(scores) for rank in row["hit_indices"]):
        msg = "GSEA hit ranks must be one-based positions within running_scores"
        raise ValueError(msg)
    if len(scores) <= max_points:
        indices = list(range(len(scores)))
    else:
        regular_points = max_points - 2
        scale = (len(scores) - 1) / (regular_points - 1)
        indices = sorted(
            {
                *(round(index * scale) for index in range(regular_points)),
                scores.index(min(scores)),
                scores.index(max(scores)),
            }
        )
    return {
        **row,
        "rank_indices": [index + 1 for index in indices],
        "running_scores": [scores[index] for index in indices],
        "hit_scores": [scores[rank - 1] for rank in row["hit_indices"]],
    }


def _frames(term_rows: list[dict], curve_rows: list[dict], rank_rows: list[dict]) -> GseaTables:
    terms = (
        pl.DataFrame(term_rows, schema=_TERM_SCHEMA)
        if term_rows
        else pl.DataFrame(schema=_TERM_SCHEMA)
    )
    curves = (
        pl.DataFrame([_compact_curve(row) for row in curve_rows], schema=_CURVE_SCHEMA)
        if curve_rows
        else pl.DataFrame(schema=_CURVE_SCHEMA)
    )
    return GseaTables(terms, curves, pl.DataFrame(rank_rows, schema=_RANK_SCHEMA), [])


def iter_gsea_tables(source: GseaInput, method: str) -> Iterator[GseaTables]:
    """Yield one contrast at a time so large documents do not accumulate in memory."""
    source.documents.clear()
    for artifact in sorted(source.artifacts, key=lambda item: item.filename):
        digest = artifact_sha256(artifact)
        if digest != source.expected_sha256[artifact.filename]:
            msg = f"GSEA artifact checksum mismatch: {artifact.filename}"
            raise ValueError(msg)
        stage = RESULT_STAGES[artifact.name]
        term_count = 0
        with artifact.open_stream() as compressed, gzip.GzipFile(fileobj=compressed) as stream:
            for term_rows, curve_rows, rank_rows in _document_rows(stream, method, stage):
                term_count += len(term_rows)
                yield _frames(term_rows, curve_rows, rank_rows)
        source.documents.append(
            {
                "file": artifact.filename,
                "stage": stage,
                "format": "protsea-gsea-json",
                "sha256": digest,
                "terms": term_count,
            }
        )


def read_gsea_tables(
    artifacts: list[GseaArtifact],
    method: str,
    expected_sha256: dict[str, str],
) -> GseaTables:
    """Read selected delivery artifacts into typed GSEA tables."""
    source = GseaInput(artifacts, expected_sha256)
    chunks = list(iter_gsea_tables(source, method))
    terms = (
        pl.concat([chunk.terms for chunk in chunks])
        if chunks
        else pl.DataFrame(schema=_TERM_SCHEMA)
    )
    curves = (
        pl.concat([chunk.curves for chunk in chunks])
        if chunks
        else pl.DataFrame(schema=_CURVE_SCHEMA)
    )
    ranks = (
        pl.concat([chunk.ranks for chunk in chunks])
        if chunks
        else pl.DataFrame(schema=_RANK_SCHEMA)
    )
    return GseaTables(terms, curves, ranks, source.documents)
