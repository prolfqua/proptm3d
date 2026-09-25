"""Export prepared methods as portable, static ZIP websites."""

from __future__ import annotations

import json
import os
import stat
import tempfile
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from html import escape
from io import BytesIO
from pathlib import Path, PurePosixPath
from zipfile import ZIP_STORED, ZipFile, ZipInfo

import polars as pl

from proptm3d.prepared_root import available_methods, method_files

BUNDLE_KIND = "proptm3d-static-bundle"
SERVER_FILES = ("serve.py", "serve.sh", "serve.bat")
METHOD_DESCRIPTIONS = {
    "DPA": (
        "Differential PTM abundance",
        "Tests whether phosphosite intensity changes between conditions.",
    ),
    "DPU": (
        "Differential PTM usage",
        "Tests whether site intensity changes relative to total protein abundance.",
    ),
    "CF-DPU": (
        "Correct-first DPU",
        "Tests protein-corrected phosphosite abundance between conditions.",
    ),
}


def method_chooser_html(root: Path, methods: tuple[str, ...]) -> str:
    """Render the self-contained overview used by bundles and prepared-root serving."""
    manifests = [
        json.loads((root / method / "data" / "run.json").read_text()) for method in methods
    ]
    rows = []
    for method, manifest in zip(methods, manifests, strict=True):
        title, description = METHOD_DESCRIPTIONS[method]
        counts = manifest["counts"]
        rows.append(
            "<tr>"
            f'<th scope="row">{escape(method)}'
            f'<span class="method-detail">{escape(title)} — {escape(description)}</span></th>'
            f'<td class="number">{counts["proteins"]:,}</td>'
            f'<td class="number">{counts["measured_sites"]:,}</td>'
            f'<td class="number">{counts["complete_result_sites"]:,}</td>'
            f'<td class="number">{len(manifest["contrasts"]):,}</td>'
            f'<td><a class="open" href="{escape(method, quote=True)}/index.html"'
            f' aria-label="Open {escape(method, quote=True)} viewer">Open viewer →</a></td>'
            "</tr>"
        )
    contrasts = {name for manifest in manifests for name in manifest["contrasts"]}
    sample_groups = {
        sample["sample"]: sample["condition"]
        for manifest in manifests
        for sample in manifest["samples"]
    }
    group_counts = Counter(sample_groups.values())
    sample_summary = " + ".join(str(count) for _, count in sorted(group_counts.items()))
    group_detail = " · ".join(
        f"{escape(group)}: {count}" for group, count in sorted(group_counts.items())
    )
    proteomes = ", ".join(sorted({manifest["proteome"] for manifest in manifests}))
    uniprot_releases = ", ".join(sorted({m["uniprot_release"] for m in manifests}))
    alphafold_versions = ", ".join(sorted({m["alphafold_archive_version"] for m in manifests}))
    provenance = (
        f"Proteome {proteomes} · UniProt {uniprot_releases} · AlphaFold {alphafold_versions}"
    )
    template = Path(__file__).with_name("bundle_server").joinpath("overview.html").read_text()
    return (
        template.replace("{{GROUP_COUNT}}", str(len(group_counts)))
        .replace("{{GROUP_LABEL}}", "Group" if len(group_counts) == 1 else "Groups")
        .replace("{{CONTRAST_COUNT}}", str(len(contrasts)))
        .replace("{{CONTRAST_LABEL}}", "Contrast" if len(contrasts) == 1 else "Contrasts")
        .replace("{{SAMPLE_SUMMARY}}", sample_summary)
        .replace("{{GROUP_DETAIL}}", group_detail)
        .replace("{{PROVENANCE}}", escape(provenance))
        .replace("{{METHOD_ROWS}}", "\n".join(rows))
    )


def _write_file(archive: ZipFile, name: str, contents: str | bytes, *, mode: int = 0o644) -> None:
    entry = ZipInfo(name)
    entry.external_attr = (stat.S_IFREG | mode) << 16
    archive.writestr(entry, contents)


def _write_server_assets(archive: ZipFile) -> None:
    server_dir = Path(__file__).with_name("bundle_server")
    for name in SERVER_FILES:
        contents = (server_dir / name).read_text()
        if name == "serve.bat":
            contents = contents.replace("\n", "\r\n")
        _write_file(archive, name, contents, mode=0o755 if name == "serve.sh" else 0o644)


def _shared_structure_table(source: Path, *, multi_method: bool) -> bytes:
    prefix = "../shared/" if multi_method else "shared/"
    table = pl.read_parquet(source).with_columns(
        pl.col("url").str.replace("^structures/", f"{prefix}structures/"),
        pl.col("pae_url").str.replace("^pae/", f"{prefix}pae/"),
        pl.col("context_url").str.replace("^residue_context/", f"{prefix}residue_context/"),
    )
    output = BytesIO()
    table.write_parquet(output)
    return output.getvalue()


def _selected_methods(root: Path, requested: tuple[str, ...] | None) -> tuple[str, ...]:
    available = available_methods(root)
    if not available:
        msg = f"No prepared methods in {root}"
        raise ValueError(msg)
    selected = available if requested is None else requested
    if not selected or len(selected) != len(set(selected)):
        msg = "Select one or more distinct prepared methods"
        raise ValueError(msg)
    for name in selected:
        if name not in available:
            msg = f"No prepared {name} directory in {root}"
            raise ValueError(msg)
    return selected


def _shared_files(files_by_method: dict[str, dict[str, Path]]) -> dict[str, Path]:
    shared: dict[str, Path] = {}
    for files in files_by_method.values():
        for relative, source in files.items():
            if relative.startswith(("structures/", "pae/", "residue_context/")):
                previous = shared.setdefault(relative, source)
                if previous.resolve() != source.resolve():
                    msg = f"Conflicting shared structure asset: {relative}"
                    raise ValueError(msg)
    return shared


def _write_method_files(
    archive: ZipFile, files: dict[str, Path], shared: dict[str, Path], prefix: str
) -> None:
    for relative, source in sorted(files.items()):
        if relative in shared:
            continue
        if relative == "tables/structures.parquet":
            _write_file(
                archive,
                f"{prefix}{relative}",
                _shared_structure_table(source, multi_method=bool(prefix)),
            )
        else:
            archive.write(source, f"{prefix}{relative}")


def bundle_prepared_root(
    root: Path,
    method: str | tuple[str, ...] | None = None,
    output: Path | None = None,
    *,
    include_server: bool = True,
) -> Path:
    """Write a single-method or all-method portable archive beside the prepared root."""
    if not root.is_dir() or root.is_symlink():
        msg = f"Not a prepared output folder: {root}"
        raise ValueError(msg)
    root = root.resolve()
    requested = (method,) if isinstance(method, str) else method
    selected = _selected_methods(root, requested)
    suffix = "all" if requested is None else "-".join(selected)
    destination = output or root.with_name(f"{root.name}-{suffix}.zip")
    destination = destination.resolve()
    if destination.suffix.lower() != ".zip":
        msg = f"Bundle output must be a .zip file: {destination}"
        raise ValueError(msg)
    if destination.is_relative_to(root):
        msg = f"Bundle output must be outside the prepared folder: {destination}"
        raise ValueError(msg)
    if destination.exists():
        msg = f"Refusing to overwrite an existing bundle: {destination}"
        raise FileExistsError(msg)
    if not destination.parent.is_dir():
        msg = f"Bundle output directory does not exist: {destination.parent}"
        raise FileNotFoundError(msg)

    # Validate every input before writing a multi-gigabyte archive.
    files_by_method = {name: method_files(root, name, deployed=True) for name in selected}
    shared = _shared_files(files_by_method)
    multi_method = len(selected) > 1
    with tempfile.TemporaryDirectory(prefix=".proptm3d-bundle-", dir=destination.parent) as tmp:
        staging = Path(tmp) / destination.name
        with ZipFile(staging, "w", compression=ZIP_STORED, allowZip64=True) as archive:
            _write_file(
                archive,
                "bundle.json",
                json.dumps(
                    {
                        "kind": BUNDLE_KIND,
                        "schema_version": "1",
                        "layout": "all" if multi_method else "single",
                        "methods": selected,
                    }
                ),
            )
            if multi_method:
                _write_file(archive, "index.html", method_chooser_html(root, selected))
            if include_server:
                _write_server_assets(archive)
            for relative, source in sorted(shared.items()):
                archive.write(source, f"shared/{relative}")
            for name, files in files_by_method.items():
                prefix = f"{name}/" if multi_method else ""
                _write_method_files(archive, files, shared, prefix)
        os.link(staging, destination)  # create only if absent; never overwrite another bundle
    return destination


@contextmanager
def extracted_bundle(archive_path: Path) -> Iterator[Path]:
    """Extract a validated proptm3d ZIP to a temporary static-server root."""
    with ZipFile(archive_path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or any(
            PurePosixPath(name).is_absolute()
            or ".." in PurePosixPath(name).parts
            or "\\" in name
            or not stat.S_ISREG(item.external_attr >> 16)
            for name, item in ((item.filename, item) for item in archive.infolist())
        ):
            msg = f"Unsafe bundle entries in {archive_path}"
            raise ValueError(msg)
        if "bundle.json" not in names:
            msg = f"Not a proptm3d browser bundle: {archive_path}"
            raise ValueError(msg)
        manifest = json.loads(archive.read("bundle.json"))
        methods = manifest.get("methods")
        if (
            manifest.get("kind") != BUNDLE_KIND
            or manifest.get("schema_version") != "1"
            or manifest.get("layout") not in {"single", "all"}
            or not isinstance(methods, list)
            or not methods
            or any(
                not isinstance(method, str) or method not in {"DPA", "DPU", "CF-DPU"}
                for method in methods
            )
        ):
            msg = f"Not a proptm3d browser bundle: {archive_path}"
            raise ValueError(msg)
        required = {"index.html", "bundle.json"}
        prefix = "" if manifest["layout"] == "single" else None
        for method in methods:
            method_prefix = prefix if prefix is not None else f"{method}/"
            required.update({f"{method_prefix}index.html", f"{method_prefix}data/run.json"})
        if (manifest["layout"] == "single" and len(methods) != 1) or not required.issubset(names):
            msg = f"Incomplete proptm3d browser bundle: {archive_path}"
            raise ValueError(msg)
        with tempfile.TemporaryDirectory(prefix="proptm3d-serve-") as temporary:
            archive.extractall(temporary)
            yield Path(temporary)
