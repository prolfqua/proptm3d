"""Download and cache the UniProt reference-proteome sequence and feature tables."""

from __future__ import annotations

import json
import re
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

import polars as pl
import requests
from loguru import logger

UNIPROT_SEARCH = "https://rest.uniprot.org/uniprotkb/search"
UNIPROT_MAPPING = "https://rest.uniprot.org/idmapping"
FIELDS = (
    "accession,organism_id,sequence,ft_domain,ft_region,ft_motif,ft_repeat,"
    "ft_transmem,ft_signal,ft_chain"
)
PROTEOMES = {
    "MOUSE": ("UP000000589", 10090, "10090_MOUSE"),
    "HUMAN": ("UP000005640", 9606, "9606_HUMAN"),
}
PROTEIN_SCHEMA = {
    "accession": pl.String,
    "taxon_id": pl.Int64,
    "sequence": pl.String,
    "sequence_length": pl.Int64,
}
FEATURE_SCHEMA = {
    "accession": pl.String,
    "type": pl.String,
    "description": pl.String,
    "start": pl.Int64,
    "end": pl.Int64,
    "start_modifier": pl.String,
    "end_modifier": pl.String,
    "evidence": pl.String,
}


@dataclass(frozen=True, slots=True)
class Proteome:
    """Reference proteome selected from the measured FASTA identifiers."""

    id: str
    taxon_id: int
    archive_suffix: str


@dataclass(slots=True)
class AnnotationTables:
    """Complete cached proteome plus any requested foreign accessions."""

    proteins: pl.DataFrame
    features: pl.DataFrame
    proteome: Proteome
    release: str
    primary_accessions: set[str]


def infer_proteome(fasta_ids: list[str]) -> Proteome:
    """Choose the dominant supported organism, rejecting ambiguous input."""
    counts = dict.fromkeys(PROTEOMES, 0)
    for fasta_id in fasta_ids:
        match = re.search(r"_([A-Z]+)$", fasta_id)
        if match and match.group(1) in counts:
            counts[match.group(1)] += 1
    ranked = sorted(counts.items(), key=lambda item: item[1], reverse=True)
    if not ranked or ranked[0][1] == 0 or ranked[0][1] == ranked[1][1]:
        msg = "Cannot infer a unique mouse or human reference proteome"
        raise ValueError(msg)
    proteome_id, taxon_id, suffix = PROTEOMES[ranked[0][0]]
    return Proteome(proteome_id, taxon_id, suffix)


def _rows(entries: list[dict]) -> tuple[list[dict], list[dict]]:
    proteins: list[dict] = []
    features: list[dict] = []
    for entry in entries:
        accession = entry["primaryAccession"]
        sequence = entry["sequence"]
        proteins.append(
            {
                "accession": accession,
                "taxon_id": entry["organism"]["taxonId"],
                "sequence": sequence["value"],
                "sequence_length": sequence["length"],
            }
        )
        for feature in entry.get("features", []):
            start = feature["location"]["start"]
            end = feature["location"]["end"]
            features.append(
                {
                    "accession": accession,
                    "type": feature["type"],
                    "description": feature.get("description", ""),
                    "start": start.get("value"),
                    "end": end.get("value"),
                    "start_modifier": start.get("modifier", "EXACT"),
                    "end_modifier": end.get("modifier", "EXACT"),
                    "evidence": json.dumps(feature.get("evidences", []), separators=(",", ":")),
                }
            )
    return proteins, features


def _pages(
    session: requests.Session, url: str, params: dict | None = None
) -> tuple[list[dict], str]:
    entries: list[dict] = []
    release = ""
    while url:
        response = session.get(url, params=params, timeout=120)
        response.raise_for_status()
        release = response.headers.get("X-UniProt-Release", release)
        body = response.json()
        entries.extend(body["results"])
        if len(entries) % 5000 < len(body["results"]):
            logger.info("UniProt: received {} proteome entries", len(entries))
        url = response.links.get("next", {}).get("url", "")
        params = None
    return entries, release


def _complete_cache(cache_dir: Path) -> bool:
    return all(
        (cache_dir / name).is_file()
        for name in ("manifest.json", "proteins.parquet", "features.parquet")
    )


def _download_proteome(proteome: Proteome, cache_dir: Path, session: requests.Session) -> str:
    if _complete_cache(cache_dir):
        logger.info("Reusing UniProt proteome cache at {}", cache_dir)
        return json.loads((cache_dir / "manifest.json").read_text())["release"]
    cache_dir.parent.mkdir(parents=True, exist_ok=True)
    logger.info("Downloading UniProt reference proteome {}", proteome.id)
    entries, release = _pages(
        session,
        UNIPROT_SEARCH,
        {
            "query": f"proteome:{proteome.id}",
            "size": 500,
            "fields": FIELDS,
            "format": "json",
        },
    )
    if not entries or not release:
        msg = f"UniProt returned an incomplete proteome for {proteome.id}"
        raise ValueError(msg)
    protein_rows, feature_rows = _rows(entries)
    if not all(row["taxon_id"] == proteome.taxon_id for row in protein_rows):
        msg = "UniProt proteome taxon does not match the inferred organism"
        raise ValueError(msg)
    with tempfile.TemporaryDirectory(prefix=".uniprot-", dir=cache_dir.parent) as temporary:
        staged = Path(temporary)
        pl.DataFrame(protein_rows, schema=PROTEIN_SCHEMA).write_parquet(staged / "proteins.parquet")
        pl.DataFrame(feature_rows, schema=FEATURE_SCHEMA).write_parquet(staged / "features.parquet")
        (staged / "manifest.json").write_text(
            json.dumps(
                {
                    "proteome": proteome.id,
                    "release": release,
                    "count": len(protein_rows),
                }
            )
        )
        cache_dir.mkdir(exist_ok=True)
        for name in ("proteins.parquet", "features.parquet", "manifest.json"):
            (staged / name).replace(cache_dir / name)
    return release


def _map_extra(
    session: requests.Session, accessions: set[str]
) -> tuple[pl.DataFrame, pl.DataFrame]:
    if not accessions:
        return pl.DataFrame(schema=PROTEIN_SCHEMA), pl.DataFrame(schema=FEATURE_SCHEMA)
    response = session.post(
        UNIPROT_MAPPING + "/run",
        data={
            "from": "UniProtKB_AC-ID",
            "to": "UniProtKB",
            "ids": ",".join(sorted(accessions)),
        },
        timeout=120,
    )
    response.raise_for_status()
    job_id = response.json()["jobId"]
    for _ in range(60):
        status = session.get(f"{UNIPROT_MAPPING}/status/{job_id}", timeout=120)
        status.raise_for_status()
        body = status.json()
        if body.get("jobStatus") == "FINISHED" or "results" in body:
            break
        if body.get("jobStatus") in {"ERROR", "FAILED"}:
            msg = f"UniProt ID mapping failed: {job_id}"
            raise ValueError(msg)
        time.sleep(1)
    else:
        msg = "UniProt ID mapping did not finish"
        raise TimeoutError(msg)
    mapped, _ = _pages(
        session,
        f"{UNIPROT_MAPPING}/uniprotkb/results/{job_id}",
        {
            "size": 500,
            "fields": FIELDS,
            "format": "json",
        },
    )
    entries = [item["to"] for item in mapped if isinstance(item.get("to"), dict)]
    protein_rows, feature_rows = _rows(entries)
    return (
        pl.DataFrame(protein_rows, schema=PROTEIN_SCHEMA),
        pl.DataFrame(feature_rows, schema=FEATURE_SCHEMA),
    )


def load_annotations(
    fasta_ids: list[str],
    accessions: set[str],
    cache_root: Path,
    session: requests.Session | None = None,
) -> AnnotationTables:
    """Load a whole reference proteome and resolve measured foreign proteins."""
    proteome = infer_proteome(fasta_ids)
    cache_dir = cache_root / "uniprot" / proteome.id
    with requests.Session() if session is None else session as client:
        release = _download_proteome(proteome, cache_dir, client)
        proteins = pl.read_parquet(cache_dir / "proteins.parquet")
        features = pl.read_parquet(cache_dir / "features.parquet")
        primary = set(proteins["accession"].to_list())
        extras, extra_features = _map_extra(client, accessions - primary)
    proteins = pl.concat((proteins, extras), how="vertical").unique("accession")
    features = pl.concat((features, extra_features), how="vertical")
    return AnnotationTables(proteins, features, proteome, release, primary)
