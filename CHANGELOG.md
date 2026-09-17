# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

- Preserve missing integer and logical annotations when reading MuData written by R, including DPU protein-only rows without a site position.

- Read PTM statistics and embedded enrichment directly from final prophosqua MuData, before delivery workbooks are exported.

### Added

- GSEA category selector in the table view. `ptm3d --enrichment <json>...` takes the
  GSEAResult JSON files prophosqua now writes (PTM-SEA, KinaseLib, MEA), matches their
  member sequence windows against the PTM table (the site-category association is the
  N:M relation on the canonical upper-case window, so paralog sites sharing a window
  all inherit the membership), and writes a compact `data/categories.*` index. The app
  gains a category table: selecting a kinase/signature filters the protein and site
  tables to its members, while the figure keeps drawing all sites and marks the members
  (accent color, grey unlabeled context). A member-mode toggle switches between the
  leading edge and the full mapped set; a color toggle switches spheres between log2FC
  and category coloring (auto-set on select/deselect); a "Cat." column shows per site
  how many categories it belongs to; the category table reports "sites in catalog /
  total member sites" so partial catalogs are visible, not silent.
- `--sheet <name>` selects the sheet of an Excel workbook input (e.g. `DPA` in the
  combined `PTM_results.xlsx`); the first sheet remains the default.
- The three left tables carry title bars (Categories, Proteins, PTM sites), and the
  left column is resizable: drag the splitter between the tables and the 3D viewer.
- `examples/enrichment/` ships small GSEAResult JSONs (subset of the o40094 DPA
  enrichments matching the bundled top-20 CSV), and `make example` passes them, so the
  category selector is testable locally without a pipeline run.
- A global contrast dropdown in the toolbar scopes the category table, the site table,
  the 3D panels (one per contrast under "All contrasts"), and the protein table's
  Sig./Max FC columns, which now come from per-contrast stats in the catalog
  (`contrast_stats`).

### Changed (unreleased)

- The pipeline now processes **all proteins with at least one significant site** by
  default; `--max_proteins` remains as an explicit cap (used for tests and the example).
- The table view's layout: three stacked tables on the left (categories, proteins,
  sites — all seven site columns kept, compact fonts), the 3D viewer fills the right.
- With more than 50 sites drawn in one panel, site labels are shown only for category
  members and the highlighted site, keeping large proteins legible and fast.

- A second browser app, `lit.html`, where all data selection lives in two Tabulator
  tables: a protein catalog table (row click loads the protein) and a PTM site table
  with header filters — a contrast dropdown, an FDR `<=` significance filter, a
  `|log2FC| >=` effect-size filter, and text filters (site, sequence window); the
  p-value column is omitted, and the pLDDT/Exposure headers carry explanatory
  tooltips. The 3D area always shows exactly the table's filtered rows, split into
  one labeled 3Dmol panel per contrast, so the same site in several contrasts
  appears side by side; selecting a row (or clicking a sphere) only highlights and
  centers that site, never changing which sites are drawn. Clicking a
  site row pans the camera to the residue at the current zoom level and emphasizes it
  (larger sphere, highlighted label) instead of the earlier abrupt zoom — the same
  behavior applies in the classic app. Built on the
  rawDIAGQC stack (Lit, Tabulator, cbor-x, pinned via `vendor/` shims). The classic
  app links to it ("Table view") and back ("Classic view").
- Data files and the catalog are now written as CBOR by default (`cbor2`), decoded in
  the browser by cbor-x; `--format json` keeps the plain-JSON output. The format is a
  `PayloadWriter` (JSON or CBOR) chosen once at the CLI and injected into the pipeline.

- Packaged the toolkit as an installable Python project (`pyproject.toml`, uv, src layout)
  with a `ptm3d` console script.
- Test suite covering the data loader, structural annotations, structure fetching
  (network stubbed), both exporters, the pipeline, and the CLI.
- Import Linter contract enforcing the `cli -> pipeline -> leaf modules` dependency
  direction, and Ruff lint/format configuration.
- `examples/PTM_no_ERK_vs_ERK_top20.csv`: a small real prophosqua result (mouse phospho,
  top 20 significant proteins) for demos and as a loader regression fixture.
- Makefile with the standard FGCZ Python targets (`sync`, `format`, `lint`, `deps`,
  `test`, `build`, `check`, `clean`), following the `python_package_template` convention.

### Changed

- The log2FC color scale is now the classic green-white-red (green = down, red = up)
  instead of blue-white-red, in both browser apps, the standalone HTML dashboards,
  and the PyMOL scripts — it no longer clashes with the blue/cyan pLDDT backbone
  coloring.
- In the table view, the protein catalog is a full-height panel on the left (viewer
  and site table stack to its right) and gains a "Max FC" column: the signed log2FC
  of each protein's strongest site, recorded as `max_log2fc` in the catalog.
- `ptm3d serve` refreshes the browser app files in the output directory to the
  installed ptm3d version before serving, and the server sends
  `Cache-Control: no-cache`, so an old output folder or a cached browser module can
  no longer show an outdated app.

- The visualization now has two paths. New default path: the pipeline writes data files
  (per-protein JSON under `data/`, a `data/catalog.json` run index, cached PDB models)
  rendered by a static single-page JS app (`index.html` + `app.js`) copied into the
  output directory, served with the new `ptm3d serve <dir>` command; its protein
  selector replaces the old `index_3d.html` catalog page. The self-contained per-protein
  HTML dashboards (`<gene>_<acc>_3d.html`, openable directly from disk) are still
  written alongside; disable them with `--no-html`.
- The CLI is built on cyclopts instead of argparse; flags (`--input/-i`, `--output_dir/-o`,
  `--max_proteins/-m`, `--proteins/-p`) are unchanged, and `--version` is now available.
- All tables are polars DataFrames instead of pandas; Excel files are read via
  `fastexcel`, replacing the `pandas`/`openpyxl` dependencies.

- Structure fetch failures now raise `StructureFetchError`; the pipeline logs and skips
  the affected protein, while all other errors propagate instead of being silently
  swallowed per protein.
- Logging goes through loguru instead of `print`.
- The CA-neighbor exposure score (`ppse`) is computed with vectorized numpy instead of a
  Python double loop.
- Import from concrete modules (e.g. `from ptm3d.data_loader import load_ptm_data`);
  `ptm3d/__init__.py` no longer re-exports the API.

### Removed

- Two inert `set b_factor_min/max` lines from generated PyMOL scripts (not real PyMOL
  settings; coloring is done via `set_color`).
- The unused `jinja2` dependency from the documented requirements.
