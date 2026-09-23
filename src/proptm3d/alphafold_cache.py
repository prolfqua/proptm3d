"""Cache AlphaFold proteome archives and extracted compressed mmCIF models."""

from __future__ import annotations

import gzip
import json
import re
import shutil
import tarfile
import tempfile
import time
from collections.abc import Iterator
from contextlib import contextmanager
from fcntl import LOCK_EX, LOCK_UN, flock
from pathlib import Path

import requests
from loguru import logger

from proptm3d.uniprot_cache import Proteome

ARCHIVE_ROOT = "https://ftp.ebi.ac.uk/pub/databases/alphafold/latest"
PREDICTION_ROOT = "https://alphafold.ebi.ac.uk/api/prediction"
ARCHIVE_VERSION = "v6"
MODEL_NAME = re.compile(r"AF-([A-Z0-9]+)-F([0-9]+)-model_v([0-9]+)\.cif\.gz$")


def archive_name(proteome: Proteome) -> str:
    """Name the official AlphaFold proteome tar."""
    return f"{proteome.id}_{proteome.archive_suffix}_{ARCHIVE_VERSION}.tar"


def _download(url: str, target: Path, session: requests.Session) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    logger.info("Downloading AlphaFold archive or model: {}", url)
    staged = target.with_name(f"{target.name}.part")
    attempt = 0
    while True:
        downloaded = staged.stat().st_size if staged.exists() else 0
        headers = {"Range": f"bytes={downloaded}-"} if downloaded else {}
        try:
            with session.get(url, headers=headers, stream=True, timeout=(30, 120)) as response:
                if response.status_code == 416 and downloaded:
                    logger.warning("Discarding oversized AlphaFold partial download: {}", staged)
                    staged.unlink()
                    continue
                response.raise_for_status()
                mode = "ab" if downloaded and response.status_code == 206 else "wb"
                if mode == "wb":
                    downloaded = 0
                expected = response.headers.get("Content-Length")
                expected = downloaded + int(expected) if expected is not None else None
                next_report = ((downloaded // (100 * 1024 * 1024)) + 1) * 100 * 1024 * 1024
                with staged.open(mode) as output:
                    for block in response.iter_content(chunk_size=1024 * 1024):
                        output.write(block)
                        downloaded += len(block)
                        if downloaded >= next_report:
                            logger.info("AlphaFold download: {:.1f} GiB", downloaded / 1024**3)
                            next_report += 100 * 1024 * 1024
                if expected is not None and downloaded != expected:
                    msg = f"Incomplete AlphaFold download: {downloaded} of {expected} bytes"
                    raise requests.ConnectionError(msg)
            break
        except requests.RequestException:
            attempt += 1
            if attempt == 3:
                raise
            logger.warning("AlphaFold download interrupted; resuming {}", staged)
            time.sleep(2 ** (attempt - 1))
    if not staged.stat().st_size:
        msg = f"Empty AlphaFold download: {url}"
        raise ValueError(msg)
    staged.replace(target)


@contextmanager
def _archive_lock(archive: Path) -> Iterator[None]:
    lock = archive.with_suffix(".lock")
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open("w") as handle:
        flock(handle, LOCK_EX)
        try:
            yield
        finally:
            flock(handle, LOCK_UN)


def _archive(cache_root: Path, proteome: Proteome, session: requests.Session) -> Path:
    archive = cache_root / "alphafold" / archive_name(proteome)
    marker = archive.with_suffix(".complete.json")
    with _archive_lock(archive):
        if archive.is_file() and marker.is_file():
            metadata = json.loads(marker.read_text())
            if metadata["bytes"] == archive.stat().st_size:
                logger.info("Reusing AlphaFold archive at {}", archive)
                return archive
        _download(f"{ARCHIVE_ROOT}/{archive.name}", archive, session)
        if not tarfile.is_tarfile(archive):
            msg = f"AlphaFold download is not a tar archive: {archive}"
            raise ValueError(msg)
        marker.write_text(json.dumps({"archive": archive.name, "bytes": archive.stat().st_size}))
    return archive


def _prediction_metadata(session: requests.Session, accession: str, cache_dir: Path) -> list[dict]:
    cached = cache_dir / f"{accession}.json"
    if cached.is_file():
        return json.loads(cached.read_text())
    response = session.get(f"{PREDICTION_ROOT}/{accession}", timeout=120)
    if response.status_code == 404:
        entries = []
    else:
        response.raise_for_status()
        entries = response.json()
    cache_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=cache_dir, delete=False) as temporary:
        staged = Path(temporary.name)
        json.dump(entries, temporary)
    staged.replace(cached)
    return entries


def _extract_archive(
    archive: Path,
    accessions: set[str],
    models: Path,
    metadata_dir: Path,
    session: requests.Session,
) -> dict[str, list[dict]]:
    results: dict[str, list[dict]] = {accession: [] for accession in accessions}
    with tarfile.open(archive, "r:") as bundle:
        for member in bundle:
            match = MODEL_NAME.search(Path(member.name).name)
            if not member.isfile() or not match or match.group(1) not in accessions:
                continue
            accession, fragment, version = match.groups()
            filename = f"AF-{accession}-F{fragment}-model_v{version}.cif.gz"
            target = models / filename
            if not target.is_file():
                source = bundle.extractfile(member)
                if source is None:
                    msg = f"Cannot extract {member.name}"
                    raise ValueError(msg)
                with tempfile.NamedTemporaryFile(dir=models, delete=False) as temporary:
                    staged = Path(temporary.name)
                    shutil.copyfileobj(source, temporary)
                staged.replace(target)
            results[accession].append(
                {
                    "file": filename,
                    "fragment": int(fragment),
                    "version": int(version),
                    "start": 1 if fragment == "1" else None,
                    "end": None,
                }
            )
    logger.info(
        "AlphaFold archive: found models for {} of {} requested proteins",
        sum(bool(value) for value in results.values()),
        len(accessions),
    )
    for accession, fragments in results.items():
        if len(fragments) > 1:
            metadata = _prediction_metadata(session, accession, metadata_dir)
            by_fragment = {
                entry.get("modelEntityId", entry.get("entryId")): entry for entry in metadata
            }
            for fragment in fragments:
                key = f"AF-{accession}-F{fragment['fragment']}"
                detail = by_fragment.get(key)
                if detail is None:
                    continue
                fragment["start"] = detail.get("uniprotStart")
                fragment["end"] = detail.get("uniprotEnd")
    return results


def _individual_models(
    accessions: set[str], models: Path, metadata_dir: Path, session: requests.Session
) -> dict[str, list[dict]]:
    results: dict[str, list[dict]] = {}
    for accession in sorted(accessions):
        fragments = []
        for entry in _prediction_metadata(session, accession, metadata_dir):
            fragment = entry.get("modelEntityId", entry.get("entryId", ""))
            match = re.fullmatch(rf"AF-{re.escape(accession)}-F(\d+)", fragment)
            if not match:
                continue
            filename = f"AF-{accession}-F{match.group(1)}-individual.cif.gz"
            target = models / filename
            if not target.is_file():
                response = session.get(entry["cifUrl"], timeout=120)
                response.raise_for_status()
                with tempfile.NamedTemporaryFile(dir=models, delete=False) as temporary:
                    staged = Path(temporary.name)
                    with gzip.GzipFile(fileobj=temporary, mode="wb") as compressed:
                        compressed.write(response.content)
                staged.replace(target)
            fragments.append(
                {
                    "file": filename,
                    "fragment": int(match.group(1)),
                    "version": entry.get("latestVersion"),
                    "start": entry.get("uniprotStart"),
                    "end": entry.get("uniprotEnd"),
                }
            )
        results[accession] = fragments
    return results


def cache_models(
    proteome: Proteome,
    accessions: set[str],
    primary: set[str],
    cache_root: Path,
    session: requests.Session | None = None,
) -> dict[str, list[dict]]:
    """Extract measured archive entries and download foreign models during prepare."""
    models = cache_root / "alphafold" / "structures"
    metadata_dir = cache_root / "alphafold" / "prediction_metadata"
    models.mkdir(parents=True, exist_ok=True)
    with requests.Session() if session is None else session as client:
        archive = _archive(cache_root, proteome, client)
        in_archive = _extract_archive(archive, accessions & primary, models, metadata_dir, client)
        foreign = _individual_models(accessions - primary, models, metadata_dir, client)
    return in_archive | foreign
