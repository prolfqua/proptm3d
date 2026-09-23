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
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from fcntl import LOCK_EX, LOCK_UN, flock
from pathlib import Path
from queue import Queue

import requests
from loguru import logger

from proptm3d.uniprot_cache import Proteome

ARCHIVE_ROOT = "https://ftp.ebi.ac.uk/pub/databases/alphafold/latest"
PREDICTION_ROOT = "https://alphafold.ebi.ac.uk/api/prediction"
FILES_ROOT = "https://latest-release.storage.googleapis.com"
ARCHIVE_VERSION = "v6"
PAE_DOWNLOAD_WORKERS = 16
MODEL_NAME = re.compile(r"AF-([A-Z0-9]+)-F([0-9]+)-model_v([0-9]+)\.cif\.gz$")


def archive_name(proteome: Proteome) -> str:
    """Name the official AlphaFold proteome tar."""
    return f"{proteome.id}_{proteome.archive_suffix}_{ARCHIVE_VERSION}.tar"


def archive_catalog_path(cache_root: Path, proteome: Proteome) -> Path:
    """Return the model inventory written beside a cached proteome archive."""
    stem = archive_name(proteome).removesuffix(".tar")
    return cache_root / "alphafold" / f"{stem}.models.json"


def _model_id(accession: str, fragment: int | str) -> str:
    return f"AF-{accession}-F{fragment}"


def _pae_url(model_id: str, version: int | str) -> str:
    return f"{FILES_ROOT}/{model_id}-predicted_aligned_error_v{version}.json"


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
    accessions: set[str] | None,
    models: Path,
    metadata_dir: Path,
    session: requests.Session,
) -> dict[str, list[dict]]:
    results: dict[str, list[dict]] = (
        {} if accessions is None else {accession: [] for accession in accessions}
    )
    with tarfile.open(archive, "r:") as bundle:
        for member in bundle:
            match = MODEL_NAME.search(Path(member.name).name)
            if (
                not member.isfile()
                or not match
                or (accessions is not None and match.group(1) not in accessions)
            ):
                continue
            accession, fragment, version = match.groups()
            results.setdefault(accession, [])
            model_id = _model_id(accession, fragment)
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
                    "model_id": model_id,
                    "fragment": int(fragment),
                    "version": int(version),
                    "start": 1 if fragment == "1" else None,
                    "end": None,
                    "pae_url": _pae_url(model_id, version),
                }
            )
    logger.info(
        "AlphaFold archive: found models for {} of {} requested proteins",
        sum(bool(value) for value in results.values()),
        len(results) if accessions is None else len(accessions),
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
                fragment["pae_url"] = detail.get("paeDocUrl", fragment["pae_url"])
    return results


def cache_archive_models(
    proteome: Proteome,
    cache_root: Path,
    session: requests.Session | None = None,
) -> dict[str, list[dict]]:
    """Extract and catalogue every mmCIF model in one reference-proteome archive."""
    models = cache_root / "alphafold" / "structures"
    metadata_dir = cache_root / "alphafold" / "prediction_metadata"
    models.mkdir(parents=True, exist_ok=True)
    with requests.Session() if session is None else session as client:
        archive = _archive(cache_root, proteome, client)
        extracted = _extract_archive(archive, None, models, metadata_dir, client)
    catalog = {
        "archive": archive_name(proteome),
        "models": [
            {"accession": accession, **model}
            for accession, entries in extracted.items()
            for model in entries
        ],
    }
    target = archive_catalog_path(cache_root, proteome)
    with tempfile.NamedTemporaryFile(mode="w", dir=target.parent, delete=False) as temporary:
        staged = Path(temporary.name)
        json.dump(catalog, temporary)
    staged.replace(target)
    return extracted


def _individual_models(
    accessions: set[str], models: Path, metadata_dir: Path, session: requests.Session
) -> dict[str, list[dict]]:
    results: dict[str, list[dict]] = {}
    for accession in sorted(accessions):
        fragments = []
        for entry in _prediction_metadata(session, accession, metadata_dir):
            model_id = entry.get("modelEntityId", entry.get("entryId", ""))
            match = re.fullmatch(rf"AF-{re.escape(accession)}-F(\d+)", model_id)
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
                    "model_id": model_id,
                    "fragment": int(match.group(1)),
                    "version": entry.get("latestVersion"),
                    "start": entry.get("uniprotStart"),
                    "end": entry.get("uniprotEnd"),
                    "pae_url": entry.get("paeDocUrl") or _pae_url(model_id, entry["latestVersion"]),
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


def _cache_pae_file(model: dict, cache_dir: Path, session: requests.Session) -> Path:
    model_id = model["model_id"]
    version = model["version"]
    target = cache_dir / f"{model_id}-predicted_aligned_error_v{version}.json.gz"
    with _archive_lock(target):
        if target.is_file() and target.stat().st_size:
            return target
        logger.debug("Downloading AlphaFold PAE: {}", model["pae_url"])
        cache_dir.mkdir(parents=True, exist_ok=True)
        with session.get(
            model["pae_url"],
            headers={"Accept-Encoding": "gzip"},
            stream=True,
            timeout=(30, 120),
        ) as response:
            response.raise_for_status()
            if response.headers.get("Content-Encoding", "").lower() != "gzip":
                message = f"AlphaFold PAE was not served as gzip: {model['pae_url']}"
                raise ValueError(message)
            response.raw.decode_content = False
            with tempfile.NamedTemporaryFile(dir=cache_dir, delete=False) as temporary:
                staged = Path(temporary.name)
                shutil.copyfileobj(response.raw, temporary)
        try:
            staged.replace(target)
        finally:
            staged.unlink(missing_ok=True)
    return target


def _pae_models(models: dict[str, list[dict]]) -> list[dict]:
    return [
        model
        for accession in sorted(models)
        for model in sorted(models[accession], key=lambda item: item["fragment"])
    ]


def _pae_target(model: dict, cache_dir: Path) -> Path:
    return cache_dir / (f"{model['model_id']}-predicted_aligned_error_v{model['version']}.json.gz")


def _is_cached_pae(path: Path) -> bool:
    return path.is_file() and path.stat().st_size > 0


def _log_pae_progress(completed: int, total: int) -> None:
    if completed % 250 == 0 or completed == total:
        logger.info("AlphaFold PAE cache: {} of {} files ready", completed, total)


def _iter_session_pae_files(
    ready: list[tuple[str, Path]],
    missing: list[dict],
    cache_dir: Path,
    session: requests.Session,
    total: int,
) -> Iterator[tuple[str, Path]]:
    completed = len(ready)
    yield from ready
    for model in missing:
        path = _cache_pae_file(model, cache_dir, session)
        completed += 1
        _log_pae_progress(completed, total)
        yield model["file"], path


def _iter_parallel_pae_files(
    ready: list[tuple[str, Path]],
    missing: list[dict],
    cache_dir: Path,
    total: int,
) -> Iterator[tuple[str, Path]]:
    worker_count = min(PAE_DOWNLOAD_WORKERS, len(missing))
    clients = [requests.Session() for _ in range(worker_count)]
    available_clients: Queue[requests.Session] = Queue()
    for client in clients:
        available_clients.put(client)

    def cache(model: dict) -> Path:
        client = available_clients.get()
        try:
            return _cache_pae_file(model, cache_dir, client)
        finally:
            available_clients.put(client)

    executor = ThreadPoolExecutor(max_workers=worker_count)
    futures = {executor.submit(cache, model): model for model in missing}
    completed = 0
    try:
        for model_file, path in ready:
            completed += 1
            _log_pae_progress(completed, total)
            yield model_file, path
        for future in as_completed(futures):
            model = futures[future]
            path = future.result()
            completed += 1
            _log_pae_progress(completed, total)
            yield model["file"], path
    finally:
        for future in futures:
            future.cancel()
        executor.shutdown(wait=True, cancel_futures=True)
        for client in clients:
            client.close()


def iter_cached_pae_files(
    models: dict[str, list[dict]],
    cache_root: Path,
    session: requests.Session | None = None,
) -> Iterator[tuple[str, Path]]:
    """Yield cached PAE files while missing gzip objects download concurrently."""
    cache_dir = cache_root / "alphafold" / "pae"
    model_list = _pae_models(models)
    ready = [
        (model["file"], target)
        for model in model_list
        if _is_cached_pae(target := _pae_target(model, cache_dir))
    ]
    missing = [model for model in model_list if not _is_cached_pae(_pae_target(model, cache_dir))]
    total = len(model_list)
    logger.info(
        "AlphaFold PAE cache: {} present, {} to download with up to {} workers",
        len(ready),
        len(missing),
        min(PAE_DOWNLOAD_WORKERS, len(missing)),
    )

    if session is not None:
        yield from _iter_session_pae_files(ready, missing, cache_dir, session, total)
        return

    if not missing:
        yield from ready
        return
    yield from _iter_parallel_pae_files(ready, missing, cache_dir, total)


def cache_pae_files(
    models: dict[str, list[dict]],
    cache_root: Path,
    session: requests.Session | None = None,
) -> dict[str, Path]:
    """Download and cache the PAE matrix belonging to each selected model."""
    return dict(iter_cached_pae_files(models, cache_root, session))


def _cached_model_inventory(proteome: Proteome, cache_root: Path) -> list[dict]:
    catalog = archive_catalog_path(cache_root, proteome)
    if catalog.is_file():
        payload = json.loads(catalog.read_text())
        if payload.get("archive") != archive_name(proteome):
            message = f"AlphaFold cache catalog does not match {archive_name(proteome)}"
            raise ValueError(message)
        return payload["models"]

    archive = cache_root / "alphafold" / archive_name(proteome)
    if not archive.is_file():
        return []
    inventory = []
    with tarfile.open(archive, "r:") as bundle:
        for member in bundle:
            match = MODEL_NAME.search(Path(member.name).name)
            if not member.isfile() or not match:
                continue
            accession, fragment, version = match.groups()
            inventory.append(
                {
                    "accession": accession,
                    "file": Path(member.name).name,
                    "model_id": _model_id(accession, fragment),
                    "version": int(version),
                }
            )
    return inventory


def clean_proteome_cache(proteome: Proteome, cache_root: Path) -> dict[str, int]:
    """Remove cached AlphaFold files belonging to one reference proteome."""
    alphafold_root = cache_root / "alphafold"
    inventory = _cached_model_inventory(proteome, cache_root)
    targets = set()
    accessions = set()
    for model in inventory:
        accessions.add(model["accession"])
        structure = alphafold_root / "structures" / model["file"]
        pae = _pae_target(model, alphafold_root / "pae")
        targets.update((structure, pae, pae.with_suffix(".lock")))
        context_root = alphafold_root / "structural_context"
        for context in context_root.glob(
            f"*/{model['model_id']}-model_v{model['version']}.parquet"
        ):
            targets.update((context, context.with_suffix(".lock")))
        targets.update(context_root.glob(f"*/{model['model_id']}-model_v{model['version']}.lock"))

    for accession in accessions:
        targets.add(alphafold_root / "prediction_metadata" / f"{accession}.json")

    archive = alphafold_root / archive_name(proteome)
    targets.update(
        (
            archive,
            archive.with_name(f"{archive.name}.part"),
            archive.with_suffix(".lock"),
            archive.with_suffix(".complete.json"),
            archive_catalog_path(cache_root, proteome),
        )
    )
    archive_stem = archive_name(proteome).removesuffix(".tar")
    targets.update((alphafold_root / "structural_context").glob(f"*/{archive_stem}.complete.json"))

    removed_files = 0
    removed_bytes = 0
    for target in sorted(targets):
        if not target.is_file() and not target.is_symlink():
            continue
        removed_bytes += target.stat().st_size
        target.unlink()
        removed_files += 1
    return {
        "models": len(inventory),
        "files": removed_files,
        "bytes": removed_bytes,
    }
