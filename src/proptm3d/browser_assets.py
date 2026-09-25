"""Install the browser build bundled with the Python package."""

from __future__ import annotations

import json
from importlib.resources import files
from pathlib import Path


def install_browser_assets(folder: Path) -> None:
    """Copy packaged HTML, CSS, and JavaScript into a new prepared method."""
    source = files("proptm3d").joinpath("browser_static")
    assets = source.joinpath("assets")
    if not source.joinpath("index.html").is_file() or not assets.is_dir():
        msg = "The proptm3d installation has no built browser app"
        raise RuntimeError(msg)
    names = sorted(asset.name for asset in assets.iterdir() if asset.is_file())
    if not names:
        msg = "The proptm3d installation has no browser assets"
        raise RuntimeError(msg)
    destination = folder / "assets"
    destination.mkdir()
    (folder / "index.html").write_bytes(source.joinpath("index.html").read_bytes())
    (folder / "favicon.svg").write_bytes(source.joinpath("favicon.svg").read_bytes())
    for name in names:
        (destination / name).write_bytes(assets.joinpath(name).read_bytes())
    (folder / "data" / "browser-assets.json").write_text(
        json.dumps({"schema_version": "1", "files": [f"assets/{name}" for name in names]}, indent=2)
        + "\n"
    )
