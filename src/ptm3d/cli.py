"""Command-line interface for the ptm3d visualizer pipeline."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Literal

from cyclopts import App, Parameter

from ptm3d import pipeline, webapp
from ptm3d.payload_io import payload_writer_for

app = App(name="ptm3d", help="3D PTM & log2-Fold-Change Visualizer")


@app.default
def run(
    *,
    input_file: Annotated[Path, Parameter(name=("--input", "-i"))],
    output_dir: Annotated[Path, Parameter(name=("--output_dir", "-o"))] = Path("output_3d"),
    max_proteins: Annotated[int | None, Parameter(name=("--max_proteins", "-m"))] = None,
    proteins: Annotated[
        list[str] | None, Parameter(name=("--proteins", "-p"), consume_multiple=True)
    ] = None,
    enrichment: Annotated[
        list[Path] | None, Parameter(name=("--enrichment", "-e"), consume_multiple=True)
    ] = None,
    sheet: Annotated[str | None, Parameter(name="--sheet")] = None,
    html: bool = True,
    data_format: Annotated[Literal["cbor", "json"], Parameter(name="--format")] = "cbor",
) -> None:
    """Run the ptm3d pipeline.

    Args:
        input_file: Path to PTM results Excel/CSV/TSV file.
        output_dir: Directory for the generated data, app, HTML, and PyMOL files.
        max_proteins: Cap on the number of top proteins; by default every protein
            with a significant site is processed.
        proteins: Specific UniProt accessions to process.
        enrichment: GSEAResult JSON files from prophosqua (PTM-SEA, KinaseLib, MEA)
            for the app's category selector.
        sheet: Sheet name to read when the input is an Excel workbook (e.g. DPA in
            the combined PTM_results.xlsx); the first sheet by default.
        html: Also write a standalone HTML dashboard per protein (--no-html to skip).
        data_format: On-disk format for the app's data files and catalog.
    """
    pipeline.run_ptm3d_pipeline(
        input_file,
        output_dir,
        max_proteins=max_proteins,
        target_proteins=proteins,
        html_reports=html,
        writer=payload_writer_for(data_format),
        enrichment_files=enrichment,
        sheet=sheet if sheet is not None else 0,
    )


@app.command
def serve(directory: Path = Path("output_3d"), *, port: int = 8000) -> None:
    """Serve a generated output directory so the visualizer can run in the browser.

    The browser app assets in the directory are refreshed to the installed ptm3d
    version first, so an old output folder always gets the current app.

    Args:
        directory: The pipeline output directory to serve.
        port: TCP port to listen on.
    """
    webapp.install_app(directory)
    webapp.serve(directory, port=port)


def main() -> None:
    """Entry point for the ptm3d console script."""
    app()


if __name__ == "__main__":
    main()
