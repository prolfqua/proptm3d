# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Python installation, preparation, data-format, and API documentation now builds as a local Sphinx site and is checked in CI alongside the Python and TypeScript quality gates.
- Protein detail now clears the previous protein and site while a new protein loads; a failed load shows its error instead of leaving stale abundance available.
- The obsolete Excel/CSV browser pipeline and its static-app installer are retired. Method-scoped h5mu preparation and the deployed TypeScript app are the supported path.
- Protein detail's 3D phosphosite markers no longer draw dark wireframe shells, so their effect colors remain clear when zoomed out; marker selection still uses the colored spheres.
- Find proteins now has separate Single contrast (protein table with hover-focused volcano and protein/site scatter) and Single contrast sequlogos (independent full volcano, protein/site scatter, and logos) views. Leaving a protein row restores every red/blue point and both black backgrounds in Single contrast; automatic browser resource requests are restricted to served files while external protein links remain clickable.
- Prepared protein Parquet tables now retain the input MuData protein description and include direct UniProt and species-aware STRING links for each annotated accession.
- The main Find tab is now named Find proteins. Redundant headings within its All contrasts and Single contrast views, the Site abundance tab, and the Protein detail subtabs are removed; the global search label is shortened, while counts, context, and plot legends stay beside the content they describe.
- Dense UniProt feature names in the N-to-C plot now appear in compact, readable tooltips instead of overlapping on the tracks; colored intervals and feature-type rows remain visible, and short motifs have larger hover targets.
- One top row now holds significance cutoffs, displayed contrast, estimate type, and protein search without redundant labels or subtab search boxes. The compact Protein detail header places Show all sites beside the protein identity and shows the prepared h5mu description on a second line when available. Protein detail and Site abundance show only passing sites by default; Show all restores measured sites in the detail table, 3D/N-to-C plots, and abundance site choices. The N-to-C lollipop is the second Protein detail subtab behind the structure view.
- The DPA abundance view now pairs each site's sample boxplots with aligned total-protein sample boxplots below them, matching the DPU and CF-DPU protein evidence panels.
- Prepared method folders now serve Parquet-only data tables, including protein structures; the browser reads DEA results and abundance plots from Parquet, and the Single contrast plots show precomputed black background sites with only threshold-passing red/blue sites interactive (FDR at most 25%, minimum |log2FC| at least 1).
- Preparation is now explicit: `prepare stats [METHOD]` exports quantification and DEA Parquet tables, while `prepare gsea [METHOD] --input DELIVERY.zip` exports the same tables plus validated GSEA terms and fails when the delivery lacks GSEA results.
- `cache context HUMAN|MOUSE` computes and caches the published Bludau/StructureMap prediction-aware exposure and IDR annotations for an entire AlphaFold reference-proteome archive. Every preparation joins this completed residue cache automatically; the former `--structural-context` option is removed.
- AlphaFold PAE precomputation now preserves EBI's existing gzip objects, downloads missing files concurrently from the public GCS release bucket, and begins computing completed models immediately instead of serially downloading and recompressing the entire proteome first.
- AlphaFold cache management now uses `cache structures`, `cache context`, and organism-scoped `cache clean` subcommands; the long `precompute-structural-context` command is removed. Bare `cache` reports complete, partial, or absent local structure, PAE, and context caches for the supported HUMAN/MOUSE proteomes, while its help distinguishes EBI downloads from locally derived context and links to EBI's other proteomes.
- The browser's Find view keeps readable protein column headings, avoids redrawing plots while searching proteins, and loads smaller chart-specific Plotly bundles on demand. Clicking a protein row opens Protein detail.
- A self-hosted TypeScript browser app now explores prepared DPA, DPU, and CF-DPU methods with searchable site summaries, linked structure and N-to-C views, sequence logos, and sample-level abundance plots; the previous JavaScript frontend is archived separately.
- The DPU preparation summary now counts sites, proteins, and structures with a finite DPU fold change and FDR; measured sites without a complete DPU result remain in the catalog and are reported separately.
- `prepare stats --input` accepts a PTM statistics delivery ZIP and reads its current per-contrast result matrices without manual extraction; a missing input displays the subcommand help and exits without a traceback.
- Successful `prepare` output now prints each method's absolute folder and the command that serves it.
- Bare `serve` now lists the required method choices instead of showing a `--method` parsing error.
- The CLI now prepares, serves, and cleans DPA, DPU, or CF-DPU method packages from `PTM_statistics.h5mu`. With no method, `prepare` and `clean` handle all three; a bare command shows help.
- Serving a prepared method uses static files only, including cached compressed AlphaFold models.
- Interrupted multi-gigabyte AlphaFold archive downloads now retain a partial file and resume with HTTP Range requests.
- UniProt accession mappings and AlphaFold prediction metadata are cached across preparations; concurrent preparations share the archive download, and oversized or short downloads are retried.

- Prepared packages retain all measured sites and aligned sample evidence, including missing values, alongside method-specific effects, original site/protein fold changes, UniProt feature coordinates, and annotation status.

- One browser app instead of two, laid out as rawDIAGQC's viewer is: `app.js` is the
  composition root, `lib/session.js` holds the selection state and every derivation
  the views need (contrast scope, category membership, site decoration, rows per
  contrast) with node tests, `shell/ptm-app.js` is a Lit shell that only emits
  intents, and `render/` holds the Tabulator, 3Dmol (`ViewerPool`) and Plotly
  backends. Two workspaces in a tab strip: **Find** (categories and the protein table
  with header filters and a matched/total counter; a row click opens the protein) and
  **Protein** (site table, one 3D panel per contrast with a pLDDT and log2FC legend
  overlay, the N-to-C pane). The classic card app (`index.html` + old `app.js`), the
  `lit.html` page and its monolithic `lit-app.js` are gone; `index.html` is the app.
- The site table shows an imputation column; 3Dmol is pinned to 2.5.5 on jsdelivr
  instead of the unversioned 3dmol.org build.

### Renamed

- The project, package and console script are now `proptm3d` (`import proptm3d`,
  `proptm3d --input ...`, `proptm3d serve`); the structure cache default moved from
  `~/.cache/ptm3d_structures` to `~/.cache/proptm3d`. The ptm-pipeline configuration
  key, rule names and output folder follow (`proptm3d:` in `ptm_config.yaml`,
  `<analysis>/proptm3d/index.html`); `ptm-pipeline update` renames the key in existing
  projects.

- N-to-C lollipop pane under the 3D panels of the table view: one row per drawn
  contrast sharing the residue axis, a stick from zero to each site's log2FC, heads
  colored like the 3D spheres, dashed sticks and open heads for imputed estimates, an
  asterisk over sites at or below the run's FDR threshold, and a band at the
  protein-level log2FC where the analysis has one. Clicking a head selects the site row
  exactly like clicking a sphere; the selected site gets the large head. The figure is
  built by the pure module `assets/panels/ntoc.js` (node tests under `tests/web/`,
  `make test-web`) and drawn by Plotly (`assets/render/plotly.js`, pinned in
  `vendor/plotly.js`).
- `--fdr` on the CLI: the significance threshold for protein selection and the
  catalog's significant-site counts, recorded in the catalog as `fdr_threshold`; the
  ptm-pipeline rule passes its own `fdr` so the 3D catalog agrees with the reports.
- Payloads carry `sequence`, `protein_length`, `protein_log2fc` per contrast and an
  `imputed` flag per site, derived from the `estimate_type` columns the way
  prophosqua's `.imputation_status` does; the MuData reader passes those columns
  through.

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
