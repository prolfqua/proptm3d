"""Persistent discovery of PTM Pipeline and proptm3d upload artifacts."""

from __future__ import annotations

import json
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path

from platformdirs import user_data_path

HISTORY_KIND = "proptm3d-upload-artifacts"
PREPARED_PREFIX = "proptm3d_"


@dataclass(frozen=True, slots=True)
class UploadPair:
    """A completed PTM delivery and its derived all-method proptm3d bundle."""

    prepared_root: Path
    pipeline_zip: Path
    proptm3d_zip: Path


def cache_path() -> Path:
    """Return the user-level upload artifact cache path."""
    return user_data_path("proptm3d") / "upload-artifacts.json"


def _records() -> list[dict[str, str]]:
    path = cache_path()
    if not path.is_file():
        return []
    document = json.loads(path.read_text())
    if document.get("kind") != HISTORY_KIND or not isinstance(document.get("records"), list):
        msg = f"Invalid upload artifact cache: {path}"
        raise ValueError(msg)
    return document["records"]


def _save(records: list[dict[str, str]]) -> None:
    path = cache_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".upload-artifacts-", dir=path.parent) as temporary:
        staging = Path(temporary) / path.name
        staging.write_text(json.dumps({"kind": HISTORY_KIND, "records": records}, indent=2))
        staging.replace(path)


def _update(root: Path, **paths: Path) -> None:
    canonical = root.resolve()
    records = _records()
    existing = next(
        (record for record in records if Path(record["prepared_root"]) == canonical),
        None,
    )
    if existing is None:
        existing = {"prepared_root": str(canonical)}
        records.append(existing)
    for name, path in paths.items():
        existing[name] = str(path.resolve())
    _save(records)


def record_preparation(input_file: Path, prepared_root: Path) -> None:
    """Cache a ZIP used to create a prepared root."""
    if input_file.suffix.lower() == ".zip":
        _update(prepared_root, pipeline_zip=input_file)


def record_bundle(prepared_root: Path, bundle_file: Path) -> None:
    """Cache a bundle created from a prepared root."""
    _update(prepared_root, proptm3d_zip=bundle_file)


def pair_from_paths(pipeline_zip: Path, proptm3d_zip: Path) -> UploadPair:
    """Construct an upload pair from paths entered interactively."""
    pipeline_zip = pipeline_zip.expanduser().resolve()
    proptm3d_zip = proptm3d_zip.expanduser().resolve()
    suffix = "-all.zip"
    prepared_root = (
        proptm3d_zip.with_name(proptm3d_zip.name.removesuffix(suffix))
        if proptm3d_zip.name.endswith(suffix)
        else proptm3d_zip.parent
    )
    return UploadPair(prepared_root, pipeline_zip, proptm3d_zip)


def record_pair(pair: UploadPair) -> None:
    """Cache a manually selected and validated artifact pair."""
    _update(
        pair.prepared_root,
        pipeline_zip=pair.pipeline_zip,
        proptm3d_zip=pair.proptm3d_zip,
    )


def _pair(record: dict[str, str]) -> UploadPair | None:
    required = {"prepared_root", "pipeline_zip", "proptm3d_zip"}
    if not required.issubset(record):
        return None
    pair = UploadPair(**{name: Path(record[name]) for name in required})
    if pair.pipeline_zip.is_file() and pair.proptm3d_zip.is_file():
        return pair
    return None


def _inferred_pair(root: Path) -> UploadPair | None:
    if not root.name.startswith(PREPARED_PREFIX):
        return None
    stem = root.name.removeprefix(PREPARED_PREFIX)
    pair = UploadPair(
        prepared_root=root.resolve(),
        pipeline_zip=root.with_name(f"{stem}.zip").resolve(),
        proptm3d_zip=root.with_name(f"{root.name}-all.zip").resolve(),
    )
    if pair.pipeline_zip.is_file() and pair.proptm3d_zip.is_file():
        return pair
    return None


def latest_upload_pair(prepared_roots: tuple[Path, ...] = ()) -> UploadPair:
    """Return the newest complete cached pair, with named-root inference for prior runs."""
    for record in reversed(_records()):
        if pair := _pair(record):
            return pair
    for root in reversed(prepared_roots):
        if pair := _inferred_pair(root):
            return pair
    msg = "No completed PTM Pipeline and proptm3d ZIP pair is recorded"
    raise FileNotFoundError(msg)


def describe(pair: UploadPair) -> dict[str, str]:
    """Return a serializable representation for diagnostics."""
    return {name: str(path) for name, path in asdict(pair).items()}
