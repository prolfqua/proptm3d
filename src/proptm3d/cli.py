"""AlphaFold caching, method-scoped preparation, and static serving commands."""

from __future__ import annotations

import shlex
import sys
from pathlib import Path
from typing import Annotated, Literal

from cyclopts import App, Parameter

from proptm3d import (
    alphafold_cache,
    prepared_history,
    prepared_root,
    structural_context_cache,
    webapp,
)
from proptm3d import bundle as bundling
from proptm3d import prepare as preparation

Method = Literal["DPA", "DPU", "CF-DPU"]
Organism = Literal["HUMAN", "MOUSE"]
app = App(
    name="proptm3d",
    help="Cache AlphaFold data, then prepare and serve PTM structure analysis artifacts",
)
prepare_app = App(name="prepare", help="Prepare browser tables from PTM analysis artifacts.")
cache_app = App(
    name="cache",
    help=(
        "Cache AlphaFold v6 data from EBI. Supported by proptm3d: HUMAN, MOUSE. "
        "See other EBI proteomes at https://alphafold.ebi.ac.uk/download. Structures and "
        "PAE files are downloaded; pPSE and IDR context is derived locally."
    ),
)
app.command(prepare_app)
app.command(cache_app)


def _preparation_target(first: str, folder: Path | None) -> tuple[Path, tuple[str, ...]]:
    if folder is None:
        return Path(first), tuple(preparation.METHOD_SPECS)
    if first not in preparation.METHOD_SPECS:
        choices = ", ".join(preparation.METHOD_SPECS)
        msg = f"Unknown method {first!r}; choose {choices}"
        raise ValueError(msg)
    return folder, (first,)


def _cache_state(status: dict, noun: str) -> str:
    total = status["total"]
    cached = status["cached"]
    if total == 0:
        return "not cached"
    if status["available"]:
        return f"available ({cached:,} {noun})"
    return f"partial ({cached:,}/{total:,} {noun})"


@cache_app.default
def show_cache_status() -> None:
    """Show cache commands and current local availability."""
    app.help_print("cache")
    print(f"\nLocal cache: {structural_context_cache.DEFAULT_CACHE_ROOT}")
    for status in structural_context_cache.cache_statuses(
        structural_context_cache.DEFAULT_CACHE_ROOT
    ):
        print(f"  {status['organism']} ({status['proteome']})")
        print(f"    structures  {_cache_state(status['structures'], 'models')}")
        print(f"    PAE         {_cache_state(status['pae'], 'files')}")
        context = _cache_state(status["context"], "models")
        if status["context"]["available"]:
            context = f"{context}, {status['context']['algorithm']}"
        print(f"    context     {context}")


def _require_input(input_file: Path, command: str) -> None:
    if not input_file.is_file():
        print(f"Input not found: {input_file.resolve()}\n", file=sys.stderr)
        prepare_app.help_print(command)
        raise SystemExit(2)


def _print_prepared(manifests: list[dict], output_dir: Path) -> None:
    output_root = output_dir.resolve()
    for manifest in manifests:
        counts = manifest["counts"]
        prepared_method = manifest["method"]
        if prepared_method == "DPU":
            print(
                f"Prepared DPU: {counts['complete_result_sites']} sites with fold change and FDR, "
                f"{counts['complete_result_proteins']} proteins, "
                f"{counts['complete_result_structures']} structures"
            )
            print(
                f"  {counts['measured_sites_without_result']} measured sites without a complete "
                "DPU result remain in the catalog"
            )
        else:
            print(
                f"Prepared {prepared_method}: {counts['measured_sites']} measured sites, "
                f"{counts['proteins']} proteins, "
                f"{counts['with_structures']} structures"
            )
        print(
            "  Structural context: "
            f"{counts['structural_context_matched_sites']} matched sites across "
            f"{counts['structural_context_models']} models"
        )
        if manifest["preparation"] == "gsea":
            print(f"  GSEA: {counts['gsea_terms']} terms across {counts['gsea_sources']} sources")
        print(f"  Folder: {output_root / prepared_method}")
        print(f"  Serve: proptm3d serve {prepared_method} {shlex.quote(str(output_root))}")


@prepare_app.command(name="stats")
def prepare_stats(
    folder_or_method: str,
    folder: Path | None = None,
    *,
    input_file: Annotated[Path, Parameter(name="--input")],
) -> None:
    """Prepare quantification and DEA Parquet tables, including cached structure context."""
    output_dir, methods = _preparation_target(folder_or_method, folder)
    _require_input(input_file, "stats")
    manifests = preparation.prepare_stats(input_file, output_dir, methods)
    prepared_history.register(output_dir)
    _print_prepared(manifests, output_dir)


@prepare_app.command(name="gsea")
def prepare_gsea(
    folder_or_method: str,
    folder: Path | None = None,
    *,
    input_file: Annotated[Path, Parameter(name="--input")],
) -> None:
    """Prepare stats plus GSEA Parquet tables from a completed PTM delivery ZIP."""
    output_dir, methods = _preparation_target(folder_or_method, folder)
    _require_input(input_file, "gsea")
    manifests = preparation.prepare_gsea(input_file, output_dir, methods)
    prepared_history.register(output_dir)
    _print_prepared(manifests, output_dir)


@cache_app.command(name="structures")
def cache_structures(organism: Organism) -> None:
    """Cache EBI AlphaFold compressed mmCIF structures for a supported proteome."""
    proteome = structural_context_cache.proteome_for_organism(organism)
    models = alphafold_cache.cache_archive_models(
        proteome, structural_context_cache.DEFAULT_CACHE_ROOT
    )
    model_count = sum(len(entries) for entries in models.values())
    structure_dir = structural_context_cache.DEFAULT_CACHE_ROOT / "alphafold" / "structures"
    print(f"Cached {model_count} AlphaFold structure models across {len(models)} accessions")
    print(f"  Structures: {structure_dir}")


@cache_app.command(name="context")
def cache_context(organism: Organism) -> None:
    """Cache EBI PAE files and locally derive pPSE/IDR for a supported proteome."""
    proteome = structural_context_cache.proteome_for_organism(organism)
    manifest = structural_context_cache.precompute_archive_context(
        proteome, structural_context_cache.DEFAULT_CACHE_ROOT
    )
    marker = structural_context_cache.context_manifest_path(
        proteome, structural_context_cache.DEFAULT_CACHE_ROOT
    )
    print(
        f"Precomputed structural context for {manifest['models']} models "
        f"across {manifest['accessions']} accessions"
    )
    print(f"  Manifest: {marker}")


@cache_app.command(name="clean")
def clean_cache(organism: Organism) -> None:
    """Remove the cached AlphaFold structures and context for one organism."""
    proteome = structural_context_cache.proteome_for_organism(organism)
    summary = alphafold_cache.clean_proteome_cache(
        proteome, structural_context_cache.DEFAULT_CACHE_ROOT
    )
    print(
        f"Removed {summary['files']} cached files ({summary['bytes'] / 1024**3:.2f} GiB) "
        f"for {summary['models']} {organism} AlphaFold models"
    )


@app.command
def clean(folder: Path) -> None:
    """Remove one wholly owned prepared output folder; keep inputs and shared cache."""
    removed = prepared_root.clean_prepared_root(folder)
    prepared_history.forget(removed)
    print(f"Removed {removed}")


@app.command
def serve(
    target: str,
    folder: Path | None = None,
    *,
    port: int = 8000,
) -> None:
    """Serve all methods in a prepared root, one METHOD FOLDER, or a bundle ZIP."""
    if folder is None:
        path = Path(target)
        if path.is_dir():
            if path.is_symlink():
                msg = f"Refusing to serve a symlinked prepared folder: {path}"
                raise ValueError(msg)
            methods = prepared_root.available_methods(path)
            entries = {entry.name for entry in path.iterdir()}
            if (
                not methods
                or entries != set(methods)
                or any((path / method).is_symlink() for method in methods)
            ):
                msg = f"Not a prepared output folder: {path}"
                raise ValueError(msg)
            prepared_history.register(path)
            webapp.serve(
                path.resolve(),
                port=port,
                landing_page=bundling.method_chooser_html(path, methods),
            )
            return
        if path.suffix.lower() != ".zip":
            msg = "Pass a prepared FOLDER, METHOD FOLDER, or a proptm3d bundle.zip to serve"
            raise ValueError(msg)
        with bundling.extracted_bundle(path) as directory:
            webapp.serve(directory, port=port)
        return
    if target not in preparation.METHOD_SPECS:
        msg = f"Unknown method: {target}"
        raise ValueError(msg)
    selected = folder / target
    if folder.is_symlink() or selected.is_symlink():
        msg = f"Refusing to serve a symlinked prepared folder: {selected}"
        raise ValueError(msg)
    directory = selected.resolve()
    if not preparation.is_prepared(directory, target):
        msg = f"No prepared {target} directory at {directory}"
        raise ValueError(msg)
    prepared_history.register(folder)
    webapp.serve(directory, port=port)


@app.command
def bundle(
    *methods: Method,
    input_dir: Annotated[Path | None, Parameter(name="--in")] = None,
    output_file: Annotated[Path | None, Parameter(name="--out")] = None,
    include_server: bool = True,
) -> None:
    """List prepared folders, or write a portable ZIP with local server launchers."""
    if input_dir is None:
        if methods or output_file is not None:
            msg = "Pass --in FOLDER to bundle a method or all methods"
            raise ValueError(msg)
        folders = prepared_history.prepared_folders()
        if not folders:
            print("No prepared folders recorded yet.")
        for folder in folders:
            methods = prepared_root.available_methods(folder)
            print(f"{folder}: {', '.join(methods) if methods else 'unavailable'}")
        return
    try:
        output = bundling.bundle_prepared_root(
            input_dir, methods or None, output_file, include_server=include_server
        )
    except FileExistsError as error:
        print(f"{error}\nUse another --out path, or move the existing ZIP first.", file=sys.stderr)
        raise SystemExit(2) from None
    prepared_history.register(input_dir)
    bundled = ", ".join(methods or prepared_root.available_methods(input_dir))
    print(f"Bundled {bundled}")
    print(f"  ZIP: {output} ({output.stat().st_size / 1024**3:.2f} GiB)")


def main() -> None:
    """Entry point for the proptm3d console script."""
    app()


if __name__ == "__main__":
    main()
