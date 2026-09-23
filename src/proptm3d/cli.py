"""AlphaFold caching, method-scoped preparation, and static serving commands."""

from __future__ import annotations

import shlex
import sys
from pathlib import Path
from typing import Annotated, Literal

from cyclopts import App, Parameter

from proptm3d import alphafold_cache, structural_context_cache, webapp
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


def _methods(method: Method | None) -> tuple[str, ...]:
    return tuple(preparation.METHOD_SPECS) if method is None else (method,)


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
        print(
            f"  Serve: proptm3d serve {prepared_method} "
            f"--output-dir {shlex.quote(str(output_root))}"
        )


@prepare_app.command(name="stats")
def prepare_stats(
    method: Method | None = None,
    *,
    input_file: Annotated[Path, Parameter(name="--input")] = preparation.DEFAULT_INPUT,
    output_dir: Annotated[Path, Parameter(name="--output-dir")] = preparation.DEFAULT_OUTPUT,
) -> None:
    """Prepare quantification and DEA Parquet tables, including cached structure context."""
    _require_input(input_file, "stats")
    manifests = preparation.prepare_stats(input_file, output_dir, _methods(method))
    _print_prepared(manifests, output_dir)


@prepare_app.command(name="gsea")
def prepare_gsea(
    method: Method | None = None,
    *,
    input_file: Annotated[Path, Parameter(name="--input")],
    output_dir: Annotated[Path, Parameter(name="--output-dir")] = preparation.DEFAULT_OUTPUT,
) -> None:
    """Prepare stats plus GSEA Parquet tables from a completed PTM delivery ZIP."""
    _require_input(input_file, "gsea")
    manifests = preparation.prepare_gsea(input_file, output_dir, _methods(method))
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
def clean(
    method: Method | None = None,
    *,
    output_dir: Annotated[Path, Parameter(name="--output-dir")] = preparation.DEFAULT_OUTPUT,
) -> None:
    """Remove owned prepared method directories; keep the shared cache."""
    for removed in preparation.clean_methods(output_dir, _methods(method)):
        print(f"Removed {removed}")


@app.command
def serve(
    method: Method | None = None,
    *,
    output_dir: Annotated[Path, Parameter(name="--output-dir")] = preparation.DEFAULT_OUTPUT,
    port: int = 8000,
) -> None:
    """Serve one prepared method through a static local file server."""
    if method is None:
        print(
            "Choose one method to serve: DPA, DPU, or CF-DPU.\nFor example: proptm3d serve DPA",
            file=sys.stderr,
        )
        raise SystemExit(2)
    directory = (output_dir / method).resolve()
    if not preparation.is_prepared(directory, method):
        msg = (
            f"No prepared {method} directory at {directory}; run 'proptm3d prepare stats {method}'"
        )
        raise ValueError(msg)
    webapp.serve(directory, port=port)


def main() -> None:
    """Entry point for the proptm3d console script."""
    app()


if __name__ == "__main__":
    main()
