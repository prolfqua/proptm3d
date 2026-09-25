"""Validate and clean an explicitly selected prepared output root."""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path, PurePosixPath

import polars as pl

from proptm3d.prepared_data import METHOD_SPECS
from proptm3d.structural_context import CONTEXT_ALGORITHM_VERSION

MANIFEST_KIND = "proptm3d-prepared-method"
ASSET_NAME = re.compile(r"[A-Za-z0-9._-]+-[A-Za-z0-9_-]+\.(?:js|css)\Z")


def is_prepared(directory: Path, method: str | None = None) -> bool:
    """Check a method-owned manifest before serving, replacing, or cleaning."""
    manifest = directory / "data" / "run.json"
    if not manifest.is_file():
        return False
    data = json.loads(manifest.read_text())
    return data.get("kind") == MANIFEST_KIND and (method is None or data.get("method") == method)


def available_methods(root: Path) -> tuple[str, ...]:
    """Return the methods with valid preparation manifests under one root."""
    return tuple(method for method in METHOD_SPECS if is_prepared(root / method, method))


def _relative_url(url: str, prefix: str) -> str:
    path = PurePosixPath(url)
    if path.is_absolute() or len(path.parts) != 2 or path.parts[0] != prefix:
        msg = f"Unexpected prepared path: {url}"
        raise ValueError(msg)
    if path.parts[1] in {".", ".."}:
        msg = f"Unexpected prepared path: {url}"
        raise ValueError(msg)
    return path.as_posix()


def _file(folder: Path, relative: str) -> Path:
    path = folder / relative
    if not relative.startswith("structures/"):
        for parent in path.parents:
            if parent == folder:
                break
            if parent.is_symlink():
                msg = f"Unexpected prepared link: {parent}"
                raise ValueError(msg)
    if path.is_symlink() and relative.startswith("pae/"):
        expected = (folder / "structures").resolve().parent / "pae" / path.name
        if path.resolve() != expected:
            msg = f"Unexpected prepared link: {path}"
            raise ValueError(msg)
    elif path.is_symlink() and relative.startswith("residue_context/"):
        expected = (
            (folder / "structures").resolve().parent
            / "structural_context"
            / CONTEXT_ALGORITHM_VERSION
            / path.name
        )
        if path.resolve() != expected:
            msg = f"Unexpected prepared link: {path}"
            raise ValueError(msg)
    elif path.is_symlink():
        msg = f"Unexpected prepared link: {path}"
        raise ValueError(msg)
    if not path.is_file():
        msg = f"Missing prepared file: {path}"
        raise ValueError(msg)
    return path


def _referenced_models(table: Path) -> tuple[set[str], set[str], set[str]]:
    rows = pl.read_parquet(table)
    structures = {_relative_url(url, "structures") for url in rows["url"].drop_nulls().to_list()}
    pae = {_relative_url(url, "pae") for url in rows["pae_url"].drop_nulls().to_list()}
    contexts = (
        {
            _relative_url(url, "residue_context")
            for url in rows["context_url"].drop_nulls().to_list()
        }
        if "context_url" in rows.columns
        else set()
    )
    return structures, pae, contexts


def _background_files(folder: Path, paths: dict[str, Path]) -> bool:
    backgrounds = folder / "data" / "plot_backgrounds.json"
    if not backgrounds.exists():
        return False
    paths["data/plot_backgrounds.json"] = _file(folder, "data/plot_backgrounds.json")
    document = json.loads(backgrounds.read_text())
    for plots in document["plots"].values():
        for plot in plots.values():
            relative = _relative_url(plot["file"].removeprefix("data/"), "plot_backgrounds")
            paths[f"data/{relative}"] = _file(folder, f"data/{relative}")
    return True


def _asset_files(folder: Path, paths: dict[str, Path]) -> set[str]:
    assets = folder / "assets"
    if not assets.exists():
        return set()
    if not assets.is_dir() or assets.is_symlink():
        msg = f"Invalid browser assets directory: {assets}"
        raise ValueError(msg)
    for asset in assets.iterdir():
        if not ASSET_NAME.fullmatch(asset.name) or asset.is_symlink():
            msg = f"Unrecognized browser asset: {asset}"
            raise ValueError(msg)
        paths[f"assets/{asset.name}"] = _file(folder, f"assets/{asset.name}")
    return {f"assets/{asset.name}" for asset in assets.iterdir()}


def _asset_inventory(folder: Path, paths: dict[str, Path], actual: set[str]) -> bool:
    inventory = folder / "data" / "browser-assets.json"
    if not inventory.exists():
        return False
    paths["data/browser-assets.json"] = _file(folder, "data/browser-assets.json")
    document = json.loads(inventory.read_text())
    files = document.get("files")
    if document.get("schema_version") != "1" or not isinstance(files, list) or not files:
        msg = f"Invalid browser asset inventory: {inventory}"
        raise ValueError(msg)
    expected = set()
    for relative in files:
        if not isinstance(relative, str):
            msg = f"Invalid browser asset inventory: {inventory}"
            raise ValueError(msg)
        relative = _relative_url(relative, "assets")
        if not ASSET_NAME.fullmatch(PurePosixPath(relative).name):
            msg = f"Invalid browser asset inventory: {inventory}"
            raise ValueError(msg)
        expected.add(relative)
        paths[relative] = _file(folder, relative)
    if actual != expected:
        msg = f"Browser assets differ from their inventory in {folder}"
        raise ValueError(msg)
    return True


def _browser_files(folder: Path, paths: dict[str, Path], *, deployed: bool) -> None:
    favicon = folder / "favicon.svg"
    if favicon.exists():
        paths["favicon.svg"] = _file(folder, "favicon.svg")
    assets = _asset_files(folder, paths)
    has_inventory = _asset_inventory(folder, paths, assets)
    has_backgrounds = _background_files(folder, paths)
    if deployed:
        html = paths["index.html"].read_text()
        if "<ptm-browser-app>" not in html:
            msg = f"Browser app is not deployed in {folder}; run npm run deploy first"
            raise ValueError(msg)
        if "favicon.svg" not in paths or not has_inventory:
            msg = f"Browser assets are missing in {folder}"
            raise ValueError(msg)
        references = re.findall(r"(?:src|href)=[\"']\./assets/([^\"']+)", html)
        if not references or any(f"assets/{name}" not in paths for name in references):
            msg = f"Browser app references missing assets in {folder}"
            raise ValueError(msg)
        if not has_backgrounds:
            msg = f"Plot backgrounds are missing in {folder}"
            raise ValueError(msg)


def _method_files(
    folder: Path, method: str, *, deployed: bool, linked_files: bool
) -> dict[str, Path]:
    if folder.is_symlink() or not is_prepared(folder, method):
        msg = f"No prepared {method} directory at {folder}"
        raise ValueError(msg)
    manifest = json.loads((folder / "data" / "run.json").read_text())
    paths = {
        "index.html": _file(folder, "index.html"),
        "data/run.json": _file(folder, "data/run.json"),
    }
    if not (folder / "structures").is_symlink():
        msg = f"Missing prepared structure link: {folder / 'structures'}"
        raise ValueError(msg)
    if not (folder / "pae").is_dir() or (folder / "pae").is_symlink():
        msg = f"Missing prepared PAE directory: {folder / 'pae'}"
        raise ValueError(msg)
    if (folder / "residue_context").exists() and (
        not (folder / "residue_context").is_dir() or (folder / "residue_context").is_symlink()
    ):
        msg = f"Missing prepared residue context directory: {folder / 'residue_context'}"
        raise ValueError(msg)
    for url in manifest["files"].values():
        relative = _relative_url(url, "tables")
        paths[relative] = _file(folder, relative)
    table = paths["tables/structures.parquet"]
    structures, pae, contexts = _referenced_models(table)
    if contexts and not (folder / "residue_context").is_dir():
        msg = f"Missing prepared residue context directory: {folder / 'residue_context'}"
        raise ValueError(msg)
    for url in structures | pae | contexts:
        paths[url] = _file(folder, url) if linked_files else folder / url
    _browser_files(folder, paths, deployed=deployed)
    return paths


def method_files(
    root: Path, method: str, *, deployed: bool = False, linked_files: bool = True
) -> dict[str, Path]:
    """Return every owned file in a method, materializing referenced cache URLs."""
    return _method_files(root / method, method, deployed=deployed, linked_files=linked_files)


def _owned_entries(folder: Path, method: str) -> set[str]:
    files = _method_files(folder, method, deployed=False, linked_files=False)
    expected = {"structures", "pae", "data", "tables"}
    if (folder / "residue_context").exists():
        expected.add("residue_context")
    for relative in files:
        if relative.startswith("structures/"):
            continue  # one directory symlink represents the referenced model files
        path = PurePosixPath(relative)
        expected.add(relative)
        expected.update(str(parent) for parent in path.parents if str(parent) != ".")
    return expected


def assert_owned_method(folder: Path, method: str) -> None:
    """Refuse replacement or cleanup when a prepared method has unrelated contents."""
    expected = _owned_entries(folder, method)
    actual = {str(path.relative_to(folder)) for path in folder.rglob("*")}
    extra = actual - expected
    if extra:
        msg = f"Refusing to replace or clean unrecognized files in {folder}: {sorted(extra)[:5]}"
        raise ValueError(msg)


def clean_prepared_root(root: Path) -> Path:
    """Remove a wholly owned prepared root, refusing unrelated content."""
    if root.is_symlink() or not root.is_dir():
        msg = f"Not a prepared output folder: {root}"
        raise ValueError(msg)
    canonical = root.resolve()
    if canonical in {Path.cwd().resolve(), Path.home().resolve(), Path(canonical.anchor)}:
        msg = f"Refusing to clean a broad directory: {canonical}"
        raise ValueError(msg)
    methods = available_methods(root)
    if not methods or {entry.name for entry in root.iterdir()} != set(methods):
        msg = f"Refusing to clean a folder with unrecognized contents: {root}"
        raise ValueError(msg)
    for method in methods:
        assert_owned_method(root / method, method)
    shutil.rmtree(root)
    return canonical
