"""Method-scoped preparation and static serving commands."""

from __future__ import annotations

import shlex
import sys
from pathlib import Path
from typing import Annotated, Literal

from cyclopts import App, Parameter

from proptm3d import prepare as preparation
from proptm3d import webapp

Method = Literal["DPA", "DPU", "CF-DPU"]
app = App(
    name="proptm3d", help="Prepare and serve PTM structure data from an h5mu or statistics ZIP"
)


def _methods(method: Method | None) -> tuple[str, ...]:
    return tuple(preparation.METHOD_SPECS) if method is None else (method,)


@app.command
def prepare(
    method: Method | None = None,
    *,
    input_file: Annotated[Path, Parameter(name="--input")] = preparation.DEFAULT_INPUT,
    output_dir: Annotated[Path, Parameter(name="--output-dir")] = preparation.DEFAULT_OUTPUT,
) -> None:
    """Prepare one method, or all three when METHOD is omitted.

    Reads ./PTM_statistics.h5mu by default. Use --input to select a statistics
    delivery ZIP or an h5mu elsewhere, for example:

    proptm3d prepare DPA --input /path/to/analysis_statistics.zip
    """
    if not input_file.is_file():
        print(f"Input not found: {input_file.resolve()}\n", file=sys.stderr)
        app.help_print("prepare")
        raise SystemExit(2)
    output_root = output_dir.resolve()
    for manifest in preparation.prepare_methods(input_file, output_dir, _methods(method)):
        counts = manifest["counts"]
        prepared_method = manifest["method"]
        print(
            f"Prepared {prepared_method}: {counts['measured_sites']} measured sites, "
            f"{counts['proteins']} proteins, "
            f"{counts['with_structures']} structures"
        )
        print(f"  Folder: {output_root / prepared_method}")
        print(
            f"  Serve: proptm3d serve {prepared_method} "
            f"--output-dir {shlex.quote(str(output_root))}"
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
        msg = f"No prepared {method} directory at {directory}; run 'proptm3d prepare {method}'"
        raise ValueError(msg)
    webapp.serve(directory, port=port)


def main() -> None:
    """Entry point for the proptm3d console script."""
    app()


if __name__ == "__main__":
    main()
