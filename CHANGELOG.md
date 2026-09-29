# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

### Added

- A `proptm3d` command prepares DPA, DPU, and CF-DPU static browser sites from `PTM_statistics.h5mu`, statistics delivery ZIPs, or completed delivery ZIPs containing `PTM_results.h5mu`.
- `prepare stats` exports measured proteins and sites, method-specific effects and FDRs, aligned sample evidence, original site and total-protein effects, UniProt annotations, AlphaFold model metadata, and structural context as Parquet tables.
- `prepare gsea` validates completed PTM delivery artifacts and adds contrast-scoped PTM-SEA, Kinase GSEA, and MEA sequence sets, exact site memberships, leading-edge assignments, and compact running-enrichment curves.
- GSEA preparations add a Find-proteins subtab with an interactive sequence-set volcano, sortable results, running-enrichment curve, and a ranked site table for direct protein drill-down. Curve hits select their exact site rows, which report rank, running score, and sequence-set NES. Result and sequence-set selectors, GSEA FDR, leading-edge mode, and an explicit toggle apply the selected sites across the existing linked views.
- `cache structures` and `cache context` manage reusable HUMAN and MOUSE AlphaFold v6 structures, PAE matrices, and the published Bludau/StructureMap prediction-aware exposure and IDR annotations.
- A self-hosted TypeScript browser provides All contrasts, Single contrast, Single contrast sequlogos, and optional GSEA discovery views; linked Protein detail and Site abundance workspaces; volcano, protein-versus-site, N-to-C, sequence-logo, abundance, 3D structure, and PAE views; and no runtime dependency on a CDN or external data API.
- All contrasts includes a site-level UpSet plot of exact significance membership across contrasts. Selecting a bar or matrix dot filters the contrast choices, protein tables, per-contrast plot overlays, sequence logos, Protein detail, and Site abundance to the matching contrasts, sites, and proteins; a toggle beside the shared filters reports the selected site and protein counts in every workspace and suspends or restores the selection without forgetting it.
- Protein detail can color AlphaFold structures by pLDDT, exposure, predicted region, exact UniProt feature type, N-to-C position, or a neutral color. Its N-to-C plot aligns UniProt features with residue-by-residue exposure, predicted region, and pLDDT tracks.
- Independent Exposure and Region filters apply consistently to protein summaries, plots, Protein detail, 3D and N-to-C markers, and Site abundance without redefining statistical significance.
- Portable single-method, selected-method, and all-method ZIPs materialize referenced structures, PAE, and residue-context files under one shared directory. Bundles include optional Python-standard-library launchers for macOS/Linux and Windows.
- `proptm3d upload ORDER_ID WORKUNIT_NAME` discovers and validates the cached PTM Pipeline delivery and proptm3d bundle, confirms the pair or prompts for replacement paths, then uploads them as separate workunits through B-Fabric applications 431 and 434 using the shared saved client credentials after a final confirmation. Interactive uploads show live per-file percentage, transferred bytes, speed, and ETA. An explicit third positional ZIP uploads only a proptm3d bundle.
- `serve FOLDER` previews all prepared methods behind an analysis overview, `serve METHOD FOLDER` opens one method, and `serve BUNDLE.zip` validates and extracts a bundle temporarily.
- Successful preparations are recorded in user-level history for discovery by a bare `bundle` command. `clean FOLDER` removes only a wholly owned prepared root and never removes source data or the shared cache.
- Sphinx documentation, GitHub CI, Python 3.11 and 3.13 test coverage, TypeScript checks, browser-build verification, deploy smoke tests, and wheel-content verification form the package quality gate.

### Changed

- `prepare stats` and `prepare gsea` accept either delivery ZIPs or their unpacked folders; statistics preparation prefers `PTM_results.h5mu` when both result and statistics stages are present.
- `prepare stats` and `prepare gsea` now default to `proptm3d_<input basename>` beside the input when no output folder is supplied; omitting the method prepares all methods, while a method-only positional selects that method in the default folder.
- `bundle FOLDER` now bundles every prepared method and writes the shared method-chooser entry page; `--in FOLDER` remains available when positional methods select a subset.
- Completed PTM deliveries now work directly with `prepare stats`, and `prepare gsea` reads the current checksum-validated `result_*.json.gz` protsea documents recorded by `PTM_results.h5mu`.
- Statistics preparation now reads the current direct-`varm` `PTM_statistics.h5mu` layout, discovers every contrast, reports the protein-imputed `enriched_CF` CorrectFirst analysis, and exports only observed site-level estimates while retaining all measured sites.
- UniProt accessions embedded as `sp|Cont_<accession>|...` are normalized for annotation and AlphaFold lookup, so contaminant proteins no longer abort preparation with malformed prediction requests.
- Preparation writes the complete packaged browser application and Python-rendered dense-plot backgrounds, so a prepared folder can be bundled without npm, Node, or an intermediate serve/deploy step.
- Preparation now writes the multi-method chooser as the prepared root's `index.html`; bundling remains responsible for materializing shared cache files, rewriting their paths, adding launchers and metadata, and producing the portable ZIP.
- Local serving is now read-only: it serves the static files and root `index.html` written by preparation or bundling, without synthesizing an entry page or updating prepared-folder history.
- Every prepared site remains available even when it has no estimable result or matching structural context. Missing abundance remains null, and residue mismatches and unavailable context remain distinct from buried or structured classifications.
- Shared FDR, absolute log2 fold-change, contrast, estimate-type, exposure, region, and search controls update the linked workspaces. Protein detail's Show all sites restores measured sites while retaining explicit estimate and structural filters.
- The dense volcano and protein-versus-site plots retain complete static black backgrounds while exposing only qualifying red and blue points interactively. Hovering a protein row temporarily isolates that protein and restores the complete plot on leave.
- Site abundance uses a site table: hovering previews sample boxplots, leaving restores the selected site, and clicking opens it in Protein detail. DPA and DPU show aligned site and total-protein evidence; CF-DPU also shows corrected abundance.
- Multi-method overviews report experimental groups, samples per group, coverage, method descriptions, and preparation provenance without counting paired enriched and total measurements as separate samples.
- AlphaFold archive downloads resume from retained partial files, concurrent preparations share cache work, and interrupted context precomputation reuses completed model files.
- Bundling verifies the browser asset inventory, refuses incomplete or unsafe prepared roots, writes atomically, and never overwrites an existing ZIP.

### Renamed

- The project, Python package, command, cache root, and prepared-folder metadata use `proptm3d`; the earlier pre-release `ptm3d` name is retired.

### Removed

- The pre-release Excel/CSV pipeline, CBOR browser payloads, PyMOL and standalone per-protein exporters, and dual classic/table JavaScript applications are no longer supported. Their last browser sources and tests remain available in `legacy/legacy-browser-2026-09-23.zip` for historical reference only.
