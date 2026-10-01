# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

### Added

- Documentation now maps the prepared entities and keys to the browser's A/B/C set-query model and identifies the current model/view boundary.
- UpSet panels now offer a Selected/All display toggle: selecting a set focuses its intersection columns, selecting an exact intersection focuses its member rows, and All restores the full plot without changing site filtering.
- A `proptm3d` command prepares DPA, DPU, and CF-DPU static browser sites from `PTM_statistics.h5mu`, statistics delivery ZIPs, or completed delivery ZIPs containing `PTM_results.h5mu`.
- `prepare stats` exports measured proteins and sites, method-specific effects and FDRs, aligned sample evidence, original site and total-protein effects, UniProt annotations, AlphaFold model metadata, and structural context as Parquet tables.
- `prepare gsea` validates completed PTM delivery artifacts and adds contrast-scoped PTM-SEA, Kinase GSEA, and MEA sequence sets, exact site memberships, leading-edge assignments, and compact running-enrichment curves.
- GSEA preparations add a Find-proteins subtab with a sequence-set volcano, sortable results, complete running-enrichment curve, and a selected-site table for protein drill-down. The table includes log2FC, site FDR, one-based rank, running score and focused-set NES; selected hits are highlighted separately from leading edge. Curve hits select their exact site rows for protein drill-down.
- `cache structures` and `cache context` manage reusable HUMAN and MOUSE AlphaFold v6 structures, PAE matrices, and the published Bludau/StructureMap prediction-aware exposure and IDR annotations.
- A self-hosted TypeScript browser provides All contrasts, Single contrast, Single contrast sequlogos, and optional GSEA discovery views; linked Protein detail and Site abundance workspaces; volcano, protein-versus-site, N-to-C, sequence-logo, abundance, 3D structure, and PAE views; and no runtime dependency on a CDN or external data API.
- A shared filtering panel provides hierarchical A (significant contrasts), B (eligible sequence_sets) and C (filter combinations) selection. Whole-set bars and exact-intersection columns are distinct, intersections support more than 32 sets, and large A/B plots page 50 combinations without changing their membership universe.
- Protein detail can color AlphaFold structures by pLDDT, exposure, predicted region, exact UniProt feature type, N-to-C position, or a neutral color. Its N-to-C plot aligns UniProt features with residue-by-residue exposure, predicted region, and pLDDT tracks.
- Independent Exposure and Region filters apply consistently to protein summaries, plots, Protein detail, 3D and N-to-C markers, and Site abundance without redefining statistical significance.
- Portable single-method, selected-method, and all-method ZIPs materialize referenced structures, PAE, and residue-context files under one shared directory. Bundles include optional Python-standard-library launchers for macOS/Linux and Windows.
- `proptm3d upload ORDER_ID WORKUNIT_NAME` discovers and validates the cached PTM Pipeline delivery and proptm3d bundle, confirms the pair or prompts for replacement paths, then uploads them as separate workunits through B-Fabric applications 431 and 434 using the shared saved client credentials after a final confirmation. Interactive uploads show live per-file percentage, transferred bytes, speed, and ETA. An explicit third positional ZIP uploads only a proptm3d bundle.
- `serve FOLDER` previews all prepared methods behind an analysis overview, `serve METHOD FOLDER` opens one method, and `serve BUNDLE.zip` validates and extracts a bundle temporarily.
- Successful preparations are recorded in user-level history for discovery by a bare `bundle` command. `clean FOLDER` removes only a wholly owned prepared root and never removes source data or the shared cache.
- Sphinx documentation, GitHub CI, Python 3.11 and 3.13 test coverage, TypeScript checks, browser-build verification, deploy smoke tests, and wheel-content verification form the package quality gate.

### Changed

- A's upper contrast, its compatible GSEA result, the A/B/C site transitions, and the compact filter summary now share headless code paths covered by dependency tests without mounting the browser.
- C no longer has a separate Estimate contrast selector. When Estimate is enabled, it uses the upper A-permitted contrast in both Stats and GSEA browsers; changing that contrast can change the selected sites.
- Prepared capabilities now select a Stats or GSEA browser profile: Stats renders only side-by-side A/C UpSets and three Find views, while GSEA adds B and its enrichment workspace. Both profiles share the same site-selection model and common protein, plot, detail, and abundance views.
- Stats-only browsers place the A and C UpSet panels side by side on wide screens, while keeping them stacked on narrow screens.
- A's selected contrast names now restrict the upper contrast chooser; choosing one A contrast loads it in B automatically. That upper choice also drives the plots and protein detail, while A/B site sets still combine only in C.
- Browser filtering now derives A, B and C from one in-memory site–set membership model; the UpSet plots only display its results, while GSEA loading remains independent. Prepared Parquet files and filter behavior are unchanged.
- A, B and C now use the same whole-set, exact-intersection and reclick selection rules across linked views; existing site counts, filters and prepared data remain unchanged.
- The reusable UpSet plot now owns its Selected/All display toggle in the plot's top-left corner, consistently across A, B and C.
- In a named-set Selected UpSet view, left bars show overlap counts from matching intersections, put the chosen set first, and omit zero-overlap rows; dot-count choices update these plotted counts without changing site filtering or paging totals.
- Collapsing the filtering UpSets now leaves the contrast selector, protein search, and a compact selected-site, A/B/C state and active-property summary visible.
- `serve --help` now identifies the prepared output root and distinguishes DPA/DPU/CF-DPU method names from the `prepare gsea` mode; the quickstart gives the concrete MiMB folder and an alternate port for an occupied default port.
- The upper contrast and protein search remain visible above the collapsible filtering panel. Protein search is display-only; the shared upper contrast also changes B's GSEA context when B is active. C's selection count, Clear C and Show all sites live in C; inactive Clear C is hidden.
- B-selected sequence sets now determine the GSEA table rows, highlighted volcano points, and available upper running-curve choices. A table row or volcano point still opens an available running curve without changing the site filter.
- A and B selection controls and counts now sit inside their respective UpSet cards; B fills the left column while A and C stack on the right, with a single-column layout on narrower screens.
- Site FDR and |log2FC| controls sit in A; GSEA FDR, sequence-set search and leading-edge controls sit in B; Estimate, Exposure and Region sit in C. The shared contrast, GSEA method and curve focus sit above the filter. The Settings tab is removed. A and B have display-only dots-per-intersection dropdowns (exclusive to one set, exactly two sets, etc.), with paging over matching columns and no changes to selected sites or whole-set counts; C shows all observed exact combinations in All view.
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
- C defaults to union of enabled filters, with explicit exact intersections and independent contrast/curve context. Clear C retains upstream choices; global Show all sites suspends and restores the complete hierarchy, including measured sites without results.
- Protein, abundance, logo and statistical-plot views share C's site selection without reapplying filters. Dense plots retain their complete background and distinguish selected significant and non-significant sites; logos split selected valid windows by effect direction without hidden cutoffs. Hovering a protein row temporarily isolates that protein's selected points and restores the complete overlay on leave.
- Site abundance uses a site table: hovering previews sample boxplots, leaving restores the selected site, and clicking opens it in Protein detail. DPA and DPU show aligned site and total-protein evidence; CF-DPU also shows corrected abundance.
- Multi-method overviews report experimental groups, samples per group, coverage, method descriptions, and preparation provenance without counting paired enriched and total measurements as separate samples.
- AlphaFold archive downloads resume from retained partial files, concurrent preparations share cache work, and interrupted context precomputation reuses completed model files.
- Bundling verifies the browser asset inventory, refuses incomplete or unsafe prepared roots, writes atomically, and never overwrites an existing ZIP.

### Fixed

- C's All view now shows every observed exact intersection, including property-only sites, so its column counts add up to the selected-site total instead of hiding part of the union.
- UpSet count labels above intersection bars are clickable, including when the bars are too small to target.
- Tiny UpSet set-size bars can now be selected through their full row names, including by keyboard, without distorting their plotted counts.
- `serve` now prints an actionable one-line error instead of a traceback when its port is occupied or the method argument is invalid. A new invocation automatically replaces a verified proptm3d server on that port without stopping unrelated services.
- B now fills the same vertical space as A and C together, with its large UpSet plot scrolling inside the card instead of stretching the A/C grid rows.
- Finding a sequence_set now brings its B UpSet row and exact intersections into view and focuses its curve; one-/two-dot views rank B rows by their largest participating intersection instead of unrelated whole-set size.
- Dots-per-intersection dropdowns offer only counts with actual intersections. If a selected count disappears after a filter change, the display returns to All intersections without changing the site selection.
- UpSet plots retain their row-aware height after window resizing instead of collapsing inside their scroll containers.
- UpSet A/B set rows now run largest-first, and dark horizontal count labels sit outside bars without shrinking or rotating. C's set-size bars select whole filter sets, including shared sites. Statistical plots and logos explicitly account for selected sites with missing values; the orange legend now says “Selected, outside thresholds” for the current contrast.
- Contrast, GSEA method, running-curve sequence set and protein search now sit above the collapsible filters. A limits the upper contrast choices and that contrast drives B's GSEA context; the duplicate B contrast picker is removed. B's selected sets and effective sites limit the upper curve choices, and an active B locks the GSEA method. Switching contrast while B is active visibly reloads B and may change selected sites. The lower filter bar turns red and names active A/B/C branches.
- GSEA memberships now join sequence windows to source `gene_pool` ranks instead of pairing differently ordered member/hit arrays. Rank `r` uses `running_scores[r - 1]`; invalid coordinates fail clearly instead of inventing zero scores. Re-prepare GSEA outputs to correct existing exported ranks.

### Renamed

- The project, Python package, command, cache root, and prepared-folder metadata use `proptm3d`; the earlier pre-release `ptm3d` name is retired.

### Removed

- The pre-release Excel/CSV pipeline, CBOR browser payloads, PyMOL and standalone per-protein exporters, and dual classic/table JavaScript applications are no longer supported. Their last browser sources and tests remain available in `legacy/legacy-browser-2026-09-23.zip` for historical reference only.
