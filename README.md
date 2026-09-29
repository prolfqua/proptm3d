# proptm3d

`proptm3d` prepares phosphorylation quantification, DEA, structure context, and optional GSEA results as Parquet tables for the local browser application.

## Set up one analysis

This is the main path for a **mouse DPA statistics analysis**. Run these commands from the repository root. Replace the input file and output folder paths with your own; use `HUMAN` instead of `MOUSE` for human data.

1. Install the locked Python package once so the `proptm3d` command is available.

   ```bash
   uv sync --frozen
   ```

2. Cache AlphaFold models, PAE, and residue context for the organism; this can take substantial time and disk space, but is reused by later analyses.

   ```bash
   uv run proptm3d cache context MOUSE
   ```

3. Convert the analysis h5mu into DPA Parquet tables, static plot backgrounds, and a browser app in the chosen output folder.

   ```bash
   uv run proptm3d prepare stats DPA /path/to/viewer --input /path/to/PTM_statistics.h5mu
   ```

4. Create a complete ZIP website for sharing; this does not need a prior `serve` command or npm. The ZIP includes Python 3 launchers for local use.

   ```bash
   uv run proptm3d bundle DPA --in /path/to/viewer --out /path/to/DPA.zip
   ```

5. Preview that same ZIP locally; the command extracts it temporarily and serves it over HTTP.

   ```bash
   uv run proptm3d serve /path/to/DPA.zip
   ```

6. Optionally upload the cached PTM Pipeline delivery and proptm3d bundle to their separate B-Fabric applications.

   ```bash
   uv run proptm3d upload 43037 "ptm-pipeline_analysis_v3"
   ```

Open `http://127.0.0.1:8000/` after step 5. A recipient can instead extract the ZIP and run `./serve.sh` on macOS/Linux or `serve.bat` on Windows, then open the same URL; Python 3 is required. To publish instead, extract the ZIP on a static HTTP/HTTPS server. The output folder is the root containing `DPA/`; no `output_3d` suffix is added. Once the package is installed and the organism cache is ready, **prepare and bundle are the only required commands**. Neither `serve` nor `bundle` installs packages, runs npm, or downloads browser libraries. For multiple methods, completed GSEA deliveries, cleanup, deployment, and B-Fabric publishing details, see the [quickstart](docs/quickstart.md), [browser guide](docs/browser.md), [bundle guide](docs/bundles.md), and [B-Fabric upload guide](docs/bfabric.md).

To preview all prepared methods before bundling, run `proptm3d serve /path/to/viewer`. The server shows the same method chooser at `http://127.0.0.1:8000/` without changing the prepared folder or extracting a ZIP.

For the current `o43037_FP24_AntjePhospho` example, [the fish script](examples/o43037_prepare_bundle.fish) prepares DPA, DPU, and CF-DPU and bundles them together using literal `~/data_analysis/...` paths. Run it with an active `.venv` using `fish examples/o43037_prepare_bundle.fish`; it does not run npm or `uv run` and will not overwrite an existing ZIP.

The statistics delivery ZIP can be passed directly, for example:

```bash
uv run proptm3d prepare stats DPA /path/to/viewer \
  --input /path/to/PTM_HIF2a_mutant_vs_GFP_control_statistics.zip
```

The output folder and method can both be omitted. This prepares all methods beside the input in
`proptm3d_<input basename>`:

```bash
uv run proptm3d prepare stats \
  --input /path/to/PTM_HIF2a_mutant_vs_GFP_control_statistics.zip
# output: /path/to/proptm3d_PTM_HIF2a_mutant_vs_GFP_control_statistics/
```

Passing only a method, such as `prepare stats DPA --input ...`, prepares that method in the same
default folder.

`prepare stats` reads exactly one statistics-bearing `PTM_statistics.h5mu` or `PTM_results.h5mu` member and ignores `PTM_inputs.h5mu`. It discovers every contrast from the method-specific `varm/<method>__<contrast>` data frames, exports only observed site-level estimates to `tables/site_stats.parquet`, and exports quantification to `tables/measurements.parquet`, plus the supporting site, protein, annotation, structure, and structural-context tables. DPA and DPU come from `mod/enriched`; CF-DPU is the reported protein-imputed CorrectFirst analysis in `mod/enriched_CF`, including its `layers/correct_first_protein_imputed` abundance matrix.

`prepare gsea` accepts either a completed delivery ZIP or its unpacked folder. It requires `PTM_results.h5mu` and at least one recognized GSEA result artifact for every selected method. It produces all the same statistics tables plus contrast-scoped sequence-set, exact site-membership, leading-edge, and compact running-curve Parquet tables under `tables/gsea/`. A statistics-only delivery fails instead of producing a misleading GSEA package. ZIP members are extracted only temporarily; the ZIP remains unchanged. `prepare stats` likewise accepts a direct h5mu, delivery ZIP, or unpacked folder and prefers `PTM_results.h5mu` when both stages are present.

In the current PTM pipeline layout, the statistics delivery contains `PTM_statistics.h5mu`. The completed delivery contains `PTM_results.h5mu` beside `PTM_DPA/`, `PTM_DPU/`, and `PTM_CF_DPU/`; their raw gzipped protsea `result_ptm_sea.json.gz`, `result_kinase_gsea.json.gz`, and `result_mea.json.gz` documents are the checksum-validated inputs to `prepare gsea`.

Preparation infers the main organism from the `_MOUSE` or `_HUMAN` suffix of `mod/enriched/var/fasta.id` entries in the statistics h5mu, then checks the downloaded UniProt proteome's taxon ID. It refuses ambiguous organism or isoform coordinates. The UniProt reference proteome, extra accession mappings, AlphaFold archive, prediction metadata, and compressed mmCIF models are cached under `~/.cache/proptm3d` across preparations. The compressed AlphaFold proteome archive is several GiB; concurrent preparations share one archive download. `serve` performs no external requests.

Structural context is precomputed independently of a PTM analysis:

```bash
uv run proptm3d cache context MOUSE
# or
uv run proptm3d cache context HUMAN
```

EBI provides [AlphaFold bulk downloads](https://alphafold.ebi.ac.uk/download) for many organisms; `proptm3d` currently exposes only the `HUMAN` and `MOUSE` proteome bundles. Bare `proptm3d cache` prints both supported proteomes and reports whether their structures, PAE files, and derived context are available, partial, or not cached locally. `cache structures` downloads or reuses the selected EBI reference-proteome archive and extracts the compressed mmCIF coordinate models consumed by the browser. `cache context` performs that prerequisite automatically, downloads every model's PAE matrix from EBI, and locally computes residue-level prediction-aware exposure and IDR annotations from [Bludau et al.](https://doi.org/10.1371/journal.pbio.3001636), following the [MannLabs StructureMap](https://github.com/MannLabs/structuremap) procedure. CIF, PAE, and derived residue tables are versioned under `~/.cache/proptm3d`; a completion manifest is written only after every archive model has context. An interrupted run can be restarted and reuses completed cache files. `cache clean HUMAN|MOUSE` removes only the selected organism's AlphaFold archive, models, PAE, context, and prediction metadata.

The published settings are fixed: exposure is `nAA_12_70_pae <= 5`, and IDR is the 10-residue-half-window smoothed `nAA_24_180_pae <= 34.27`. This archive-wide computation is independent of DPA, DPU, CF-DPU, and their site counts.

Every `prepare stats` and `prepare gsea` run reads the completed cache and joins the relevant residue rows to the concrete site set. There is no structural-context flag. Preparation does not download PAE or calculate structural context; if the matching HUMAN or MOUSE cache is absent or incomplete, it stops with the exact `cache context` command to run. Models outside the selected reference-proteome archive remain explicitly unavailable unless matching context is already cached.

## Generated package

The prepared root contains an entry page plus one directory per method:

```text
index.html                       # method chooser
DPA/
  index.html
  data/run.json
  data/browser-assets.json
  data/plot_backgrounds.json
  data/plot_backgrounds/*.png
  assets/*.js and assets/*.css
  tables/sites.parquet
  tables/site_stats.parquet
  tables/measurements.parquet
  tables/proteins.parquet
  tables/protein_features.parquet
  tables/structures.parquet
  tables/site_structural_context.parquet
  tables/gsea/<result>/contrast-*/        # sequence sets, memberships, and curves; prepare gsea only
  structures/                    # link to shared cached .cif.gz models
  pae/                           # links to the experiment models' cached PAE .json.gz
  residue_context/               # links to referenced models' per-residue Parquet context
```

The manifest records the method, contrasts, samples and conditions, data release, archive version, file paths, and coverage counts. Preparation writes to a temporary directory and replaces a method package only after the export completes.

`proptm3d bundle FOLDER [--out FILE.zip]` produces an all-method portable website with a chooser entry page. `proptm3d bundle METHOD [METHOD ...] --in FOLDER [--out FILE.zip]` selects a subset instead. One method opens directly at the ZIP root; multiple methods open behind the chooser page. The default ZIP name is `<folder>-METHOD.zip`, `<folder>-DPA-DPU.zip`, or `<folder>-all.zip` beside the prepared folder; an existing ZIP is never overwritten. Every bundle has a `shared/` folder containing each referenced structure and PAE file once, even when multiple methods use it. The bundler checks `data/browser-assets.json` against every packaged JavaScript/CSS file and does not preserve cache symlinks. Re-prepare older folders that lack the asset inventory or Python-generated plot backgrounds. Extract the ZIP onto a static HTTP/HTTPS site before opening it—`file://` and a ZIP download cannot run the browser app. Every ZIP includes `serve.py`, `serve.sh`, and `serve.bat`; after extraction run the launcher for your platform, then open `http://127.0.0.1:8000/`. This needs Python 3 on the recipient's machine but not proptm3d, pip, or npm. Pass `--no-include-server` to omit the three launcher files for a static-site-only ZIP. `proptm3d serve FILE.zip` does the extraction temporarily for local preview. See the [deployment guide](docs/bundles.md).

The site table retains every detected site, including those without an estimable effect. The statistics table uses `(protein_Id, site, contrast)` as its key and contains only rows whose site estimate is `observed`; protein estimates used by DPU may still be imputed. The DPU protein-only result rows are excluded from site statistics. The browser reads results and abundances from Parquet; no CBOR files are written to the served method directory. Python preparation derives static black-point plot backgrounds from the results table.

`site_structural_context.parquet` contains pLDDT, the two PAE-aware neighbor counts, and the `is_exposed`/`is_idr` flags at every catalogued site position. Its key includes the AlphaFold model ID because long-protein fragments may overlap; proptm3d preserves each matching model instead of choosing one silently. Sites without context and residue mismatches remain present with an explicit `mapping_status`.

`matched` means only that the site was mapped to an AlphaFold residue with the same amino acid; it does not mean exposed, confident, or significant. `structures.parquet` carries `pae_url` and `context_url` for each model with cached annotations. The browser reads residue-context Parquet only when that protein is opened, allowing full-structure coloring by exposure and predicted IDR. UniProt feature coloring uses the prepared feature table and exact, sequence-matched coordinates. The right-side “How to read this” panel explains these labels in the app.

In the browser, FDR and |log2FC| remain the only significance criteria. The independent **Exposure** (All, Exposed, Buried) and **Region** (All, IDR, Structured) filters default to All, which shows the same sites as before; unmatched sites stay visible and labelled. Choosing a category excludes sites without a matched classification. Both filters apply to the Find proteins tables and plots, the Protein detail table, 3D and N-to-C markers, and Site abundance choices, including under Show all sites. pLDDT is shown for interpretation and is not a filter.

GSEA preparations add result, GSEA FDR, and sequence-set controls plus **Leading edge only** and an explicit **GSEA selection** toggle. The GSEA workspace shows the active result's sequence-set volcano and sortable table, then the selected set's running-enrichment curve. Selection alone only changes the GSEA views; turning on the GSEA selection toggle adds its sites to the same scope used by Find proteins, UpSet, the existing sequence logos, Protein detail, 3D and N-to-C markers, and Site abundance. Statistics-only preparations hide these controls and do not load GSEA data.

Protein detail's **PAE** tab loads the displayed model's PAE only when shown and draws it as a heatmap with guides at the selected site. Low PAE means confident relative placement of two residues; high PAE means uncertain relative placement, as between domains or across linkers. PAE is not per-residue confidence, exposure, statistical evidence, or functional importance; see the [EMBL-EBI PAE guide](https://www.ebi.ac.uk/training/online/courses/alphafold/inputs-and-outputs/evaluating-alphafolds-predicted-structures-using-confidence-scores/pae-a-measure-of-global-confidence-in-alphafold-predictions/).

The DPU preparation summary counts distinct sites with a finite DPU fold change and FDR in at least one contrast, plus proteins and structures represented by those sites. It separately reports measured sites without a complete DPU result; those sites remain in the prepared catalog. The manifest records both the measured catalog counts and complete-result counts.

| Method | Plot effect and FDR | Per-sample evidence |
|---|---|---|
| DPA | Site `diff.site`, `FDR.site` | Aligned enriched site and total protein abundance |
| DPU | `diff_diff`, `FDR_I` | Aligned enriched site and total protein abundance |
| CF-DPU | Protein-imputed CorrectFirst `diff.site`, `FDR.site` | Enriched site, total protein, and `correct_first_protein_imputed` abundance |

Every method also carries original site and total-protein fold changes for the protein-versus-site scatter. Sample alignment uses `obs/Name`, and condition labels use `obs/G_`. Missing abundance stays null. The UniProt feature export retains sequence coordinates, their modifiers, descriptions, and evidence; proteins with unavailable or mismatched sequence annotation remain in the package with an explicit status.

## Development

```bash
make sync
make check
make docs
```

`make docs` builds the [Python documentation](docs/index.md) to `docs/_build/html/index.html` and treats warnings as errors. `make check` is the CI gate: Python formatting, imports, dependencies, tests, package build, browser checks and build, and documentation build. CI runs it on Python 3.13 and runs the Python tests separately on the supported minimum, Python 3.11. Tests stub external downloads. The active Python API and CLI prepare method-scoped packages from h5mu inputs; the retired Excel/CSV browser pipeline is no longer part of the package.

The TypeScript source and pinned npm dependencies live in `web/`. Browser development uses `npm ci --prefix web` followed by `make package-web` to rebuild and copy compiled JS/CSS into the Python package. Normal analysis preparation, serving, and bundling use that packaged copy and do not invoke npm or Node.
