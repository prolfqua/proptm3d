"""Command-line interface for the proptm3d visualizer pipeline."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Literal

from cyclopts import App, Parameter

from proptm3d import pipeline, webapp
from proptm3d.payload_io import payload_writer_for

app = App(name="proptm3d", help="3D PTM & log2-Fold-Change Visualizer")


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
    fdr: Annotated[float, Parameter(name="--fdr")] = 0.05,
    html: bool = True,
    data_format: Annotated[Literal["cbor", "json"], Parameter(name="--format")] = "cbor",
) -> None:
    """Run the proptm3d pipeline.

    Args:
        input_file: Path to final PTM MuData or an Excel/CSV/TSV table.
        output_dir: Directory for the generated data, app, HTML, and PyMOL files.
        max_proteins: Cap on the number of top proteins; by default every protein
            with a significant site is processed.
        proteins: Specific UniProt accessions to process.
        enrichment: Final MuData or GSEAResult JSON files from prophosqua (PTM-SEA, KinaseLib, MEA)
            for the app's category selector.
        sheet: Sheet name to read when the input is an Excel workbook (e.g. DPA in
            the combined PTM_results.xlsx); the first sheet by default.
        fdr: FDR threshold that makes a site significant, for protein selection and
            the significant-site counts; match the threshold of the surrounding reports.
        html: Also write a standalone HTML dashboard per protein (--no-html to skip).
        data_format: On-disk format for the app's data files and catalog.
    """
    pipeline.run_proptm3d_pipeline(
        input_file,
        output_dir,
        max_proteins=max_proteins,
        min_fdr=fdr,
        target_proteins=proteins,
        html_reports=html,
        writer=payload_writer_for(data_format),
        enrichment_files=enrichment,
        sheet=sheet if sheet is not None else 0,
    )


@app.command
def serve(directory: Path = Path("output_3d"), *, port: int = 8000) -> None:
    """Serve a generated output directory so the visualizer can run in the browser.

    The browser app assets in the directory are refreshed to the installed proptm3d
    version first, so an old output folder always gets the current app.

    Args:
        directory: The pipeline output directory to serve.
        port: TCP port to listen on.
    """
    webapp.install_app(directory)
    webapp.serve(directory, port=port)


def main() -> None:
    """Entry point for the proptm3d console script."""
    app()


if __name__ == "__main__":
    main()
