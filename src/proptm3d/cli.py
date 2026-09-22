"""Method-scoped preparation and static serving commands."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Literal

from cyclopts import App, Parameter

from proptm3d import prepare as preparation
from proptm3d import webapp

Method = Literal["DPA", "DPU", "CF-DPU"]
app = App(name="proptm3d", help="Prepare and serve PTM structure data from PTM_statistics.h5mu")


def _methods(method: Method | None) -> tuple[str, ...]:
    return tuple(preparation.METHOD_SPECS) if method is None else (method,)


@app.command
def prepare(
    method: Method | None = None,
    *,
    input_file: Annotated[Path, Parameter(name="--input")] = preparation.DEFAULT_INPUT,
    output_dir: Annotated[Path, Parameter(name="--output-dir")] = preparation.DEFAULT_OUTPUT,
) -> None:
    """Prepare one method, or all three when METHOD is omitted."""
    for manifest in preparation.prepare_methods(input_file, output_dir, _methods(method)):
        counts = manifest["counts"]
        print(
            f"Prepared {manifest['method']}: {counts['proteins']} proteins, "
            f"{counts['measured_sites']} measured sites, "
            f"{counts['with_structures']} structures"
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
    method: Method,
    *,
    output_dir: Annotated[Path, Parameter(name="--output-dir")] = preparation.DEFAULT_OUTPUT,
    port: int = 8000,
) -> None:
    """Serve one prepared method through a static local file server."""
    directory = output_dir / method
    if not preparation.is_prepared(directory, method):
        msg = f"No prepared {method} directory at {directory}; run 'proptm3d prepare {method}'"
        raise ValueError(msg)
    webapp.serve(directory, port=port)


def main() -> None:
    """Entry point for the proptm3d console script."""
    app()


if __name__ == "__main__":
    main()
