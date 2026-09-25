"""User-level history of explicitly prepared output folders."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from platformdirs import user_data_path

HISTORY_KIND = "proptm3d-prepared-folders"


def history_path() -> Path:
    """Return the persistent registry path, separate from prepared data and cache."""
    return user_data_path("proptm3d") / "prepared-folders.json"


def prepared_folders() -> tuple[Path, ...]:
    """Read prepared folder paths in registration order."""
    path = history_path()
    if not path.is_file():
        return ()
    document = json.loads(path.read_text())
    if document.get("kind") != HISTORY_KIND or not isinstance(document.get("folders"), list):
        msg = f"Invalid prepared-folder history: {path}"
        raise ValueError(msg)
    return tuple(Path(folder) for folder in document["folders"])


def _save(folders: tuple[Path, ...]) -> None:
    path = history_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".prepared-folders-", dir=path.parent) as temporary:
        staging = Path(temporary) / path.name
        staging.write_text(
            json.dumps(
                {"kind": HISTORY_KIND, "folders": [str(folder) for folder in folders]},
                indent=2,
            )
        )
        staging.replace(path)


def register(folder: Path) -> None:
    """Remember one successful preparation or explicitly validated prepared root."""
    canonical = folder.resolve()
    folders = prepared_folders()
    if canonical not in folders:
        _save((*folders, canonical))


def forget(folder: Path) -> None:
    """Remove one cleaned root from the history."""
    canonical = folder.resolve()
    folders = prepared_folders()
    if canonical in folders:
        _save(tuple(item for item in folders if item != canonical))
