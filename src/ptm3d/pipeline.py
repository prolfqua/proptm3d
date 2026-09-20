"""End-to-end pipeline: select proteins, fetch structures, and generate all outputs."""

from __future__ import annotations

from pathlib import Path

import polars as pl
from loguru import logger

from ptm3d.data_loader import filter_ptm_data, load_ptm_data
from ptm3d.enrichment_loader import build_categories_payload, load_gsea_results
from ptm3d.payload_io import CborPayloadWriter, PayloadWriter
from ptm3d.protein_data import build_protein_payload
from ptm3d.pymol_exporter import generate_pymol_script
from ptm3d.structural_context import (
    annotate_structural_regions,
    calculate_ppse,
    parse_pdb_residues,
)
from ptm3d.structure_fetcher import StructureFetchError, fetch_structure
from ptm3d.web_visualizer import generate_interactive_html
from ptm3d.webapp import ProteinReport, install_app, write_catalog


def _select_targets(df: pl.DataFrame, max_proteins: int | None, min_fdr: float) -> list[str]:
    """Rank proteins by their count of significant PTM sites.

    Returns every protein with at least one significant site; ``max_proteins``
    caps that to the top N (the testing default is uncapped production use).
    """
    sig_df = df.filter(pl.col("fdr") <= min_fdr) if "fdr" in df.columns else df
    counts = sig_df["uniprot_acc"].drop_nulls().value_counts(sort=True)
    accs = counts["uniprot_acc"]
    if max_proteins is not None:
        accs = accs.head(max_proteins)
    return accs.to_list()


def _max_abs_log2fc(frame: pl.DataFrame) -> float | None:
    """Signed log2FC of the site with the largest absolute fold change."""
    if "log2fc" not in frame.columns:
        return None
    fold_changes = frame["log2fc"].drop_nulls()
    if not len(fold_changes):
        return None
    return float(fold_changes[fold_changes.abs().arg_max()])


def _contrast_stats(prot_df: pl.DataFrame, min_fdr: float) -> dict[str, dict]:
    """Per-contrast significant-site count and max fold change of one protein."""
    if "contrast" not in prot_df.columns:
        return {}
    stats: dict[str, dict] = {}
    for (contrast,), group in prot_df.group_by("contrast"):
        sig = group.filter(pl.col("fdr") <= min_fdr).height if "fdr" in group.columns else 0
        stats[str(contrast)] = {"sig_count": sig, "max_log2fc": _max_abs_log2fc(group)}
    return stats


def _process_protein(
    prot_df: pl.DataFrame,
    acc: str,
    gene_name: str,
    output_dir: Path,
    min_fdr: float,
    html_reports: bool,
    writer: PayloadWriter,
) -> ProteinReport:
    """Generate the data file, optional standalone HTML, and PyMOL script for one protein."""
    pdb_path = fetch_structure(acc, cache_dir=output_dir / "structures")

    res_df = parse_pdb_residues(pdb_path)
    res_df = calculate_ppse(res_df)
    res_df = annotate_structural_regions(res_df)

    payload = build_protein_payload(
        prot_df,
        res_df,
        protein_acc=acc,
        gene_name=gene_name,
        pdb_file=f"structures/{pdb_path.name}",
    )
    data_path = writer.write(payload, output_dir / "data" / f"{gene_name}_{acc}")
    data_file = f"data/{data_path.name}"

    if html_reports:
        generate_interactive_html(
            pdb_path,
            prot_df,
            res_df,
            output_dir / f"{gene_name}_{acc}_3d.html",
            protein_acc=acc,
            gene_name=gene_name,
        )

    pml_file = f"{gene_name}_{acc}_pymol.pml"
    generate_pymol_script(pdb_path, prot_df, output_dir / pml_file, protein_name=gene_name)

    sig_count = prot_df.filter(pl.col("fdr") <= min_fdr).height if "fdr" in prot_df.columns else 0
    return ProteinReport(
        gene_name=gene_name,
        uniprot_acc=acc,
        ptm_count=prot_df.height,
        sig_count=sig_count,
        max_log2fc=_max_abs_log2fc(prot_df),
        contrast_stats=_contrast_stats(prot_df, min_fdr),
        data_file=data_file,
        pml_file=pml_file,
    )


def run_ptm3d_pipeline(
    input_file: Path | str,
    output_dir: Path | str,
    max_proteins: int | None = None,
    min_fdr: float = 0.05,
    target_proteins: list[str] | None = None,
    html_reports: bool = True,
    writer: PayloadWriter | None = None,
    enrichment_files: list[Path] | None = None,
    sheet: int | str = 0,
) -> Path:
    """Run the end-to-end 3D PTM and log2FC visualizer pipeline.

    Writes per-protein JSON data files, cached PDB structures, PyMOL scripts, the run
    catalog, and the static browser app that renders them (view with ``ptm3d serve``).
    Optionally also writes a self-contained HTML dashboard per protein that can be
    opened directly from disk. Proteins whose structure cannot be fetched are logged
    and skipped; all other errors propagate.

    Args:
        input_file: PTM results table (Excel/CSV/TSV).
        output_dir: Directory for the generated output.
        max_proteins: Cap on the number of top significant proteins when no targets
            are given; None (the production default) processes every protein with a
            significant site.
        min_fdr: FDR threshold used for protein ranking and significance counts.
        target_proteins: Explicit UniProt accessions to process instead of ranking.
        html_reports: Also write a standalone ``<gene>_<acc>_3d.html`` per protein.
        writer: Serializer for the data files and catalog (defaults to CBOR).
        enrichment_files: GSEAResult JSON files written by prophosqua (PTM-SEA,
            KinaseLib, MEA); when given, the category index ``data/categories.*``
            is written for the browser app's category selector.
        sheet: Sheet to read (0-based index or name) when the input is an Excel
            workbook, e.g. ``"DPA"`` in the combined ``PTM_results.xlsx``.

    Returns:
        The path of the browser app entry point (``index.html``).
    """
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    if writer is None:
        writer = CborPayloadWriter()

    logger.info("Loading PTM results from {}", input_file)
    df = load_ptm_data(input_file, sheet_name=sheet)
    logger.info("Loaded {} PTM records across {} proteins", df.height, df["uniprot_acc"].n_unique())

    if target_proteins:
        targets = [t.strip() for t in target_proteins]
    else:
        targets = _select_targets(df, max_proteins, min_fdr)
    logger.info("Processing {} target protein(s): {}", len(targets), targets)

    reports: list[ProteinReport] = []
    for acc in targets:
        prot_df = filter_ptm_data(df, protein_acc=acc)
        if prot_df.is_empty():
            logger.warning("Skipping {}: no PTM records found", acc)
            continue

        gene_names = (
            prot_df["gene_name"].drop_nulls() if "gene_name" in prot_df.columns else pl.Series()
        )
        gene_name = str(gene_names[0]) if len(gene_names) else acc

        logger.info("Processing {} ({}) with {} PTM sites", gene_name, acc, prot_df.height)
        try:
            report = _process_protein(
                prot_df, acc, gene_name, out_dir, min_fdr, html_reports, writer
            )
        except StructureFetchError as error:
            logger.warning("Skipping {}: {}", acc, error)
            continue
        reports.append(report)
        logger.info("Saved {} and {}", report.data_file, report.pml_file)

    write_catalog(out_dir, reports, writer, min_fdr)
    if enrichment_files:
        enrichment = load_gsea_results(enrichment_files, analysis=sheet)
        catalog_accs = {report.uniprot_acc for report in reports}
        categories = build_categories_payload(enrichment, df, catalog_accs)
        categories_path = writer.write(categories, out_dir / "data" / "categories")
        logger.info("Wrote category index {}", categories_path)
    install_app(out_dir)
    logger.info("Browser app written to {}; view it with: ptm3d serve {}", out_dir, out_dir)
    return out_dir / "index.html"
