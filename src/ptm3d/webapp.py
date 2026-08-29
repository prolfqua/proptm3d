"""The browser apps: static assets, the run catalog, and a local HTTP server."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
from pathlib import Path
from typing import TYPE_CHECKING

from loguru import logger

if TYPE_CHECKING:
    from ptm3d.payload_io import PayloadWriter

_ASSET_NAMES = (
    "index.html",
    "app.js",
    "lit.html",
    "lit-app.js",
    "payload.js",
    "color.js",
    "viewer3d.js",
    "vendor/lit.js",
    "vendor/cbor.js",
    "vendor/tabulator.js",
)


@dataclass(frozen=True, slots=True)
class ProteinReport:
    """One processed protein and the output files generated for it.

    Attributes:
        gene_name: Gene symbol shown in the app's protein selector.
        uniprot_acc: UniProt accession.
        ptm_count: Number of PTM records for the protein.
        sig_count: Number of records significant at the FDR threshold.
        data_file: Path of the protein's JSON data file, relative to the output root.
        pml_file: Path of the PyMOL script, relative to the output root.
    """

    gene_name: str
    uniprot_acc: str
    ptm_count: int
    sig_count: int
    data_file: str
    pml_file: str


def write_catalog(
    output_dir: Path | str, reports: list[ProteinReport], writer: PayloadWriter
) -> Path:
    """Write ``data/catalog.<suffix>`` listing every processed protein.

    Args:
        output_dir: Root of the generated output.
        reports: One entry per processed protein.
        writer: Serializer deciding the on-disk format (JSON or CBOR).

    Returns:
        The path of the written catalog file.
    """
    payload = {"proteins": [asdict(report) for report in reports]}
    return writer.write(payload, Path(output_dir) / "data" / "catalog")


def install_app(output_dir: Path | str) -> None:
    """Copy the static browser app (index.html, app.js) into the output directory.

    Args:
        output_dir: Root of the generated output.
    """
    out_dir = Path(output_dir)
    assets = resources.files("ptm3d") / "assets"
    for name in _ASSET_NAMES:
        target = out_dir / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text((assets / name).read_text(encoding="utf-8"), encoding="utf-8")


def create_server(directory: Path | str, port: int = 0) -> ThreadingHTTPServer:
    """Create an HTTP server rooted at a generated output directory.

    Args:
        directory: Directory to serve.
        port: TCP port; 0 picks a free one.

    Returns:
        The configured (not yet running) server.
    """
    handler = partial(SimpleHTTPRequestHandler, directory=str(directory))
    return ThreadingHTTPServer(("127.0.0.1", port), handler)


def serve(directory: Path | str, port: int = 8000) -> None:
    """Serve a generated output directory and block until interrupted.

    Args:
        directory: Directory to serve (a ptm3d output folder).
        port: TCP port to listen on.
    """
    with create_server(directory, port) as httpd:
        host, actual_port = httpd.server_address[0], httpd.server_address[1]
        logger.info("Serving {} at http://{}:{}/ (Ctrl+C to stop)", directory, host, actual_port)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            logger.info("Server stopped")
