# proptm3d

`proptm3d` prepares phosphorylation quantification, DEA, structure context, and optional GSEA results as Parquet tables for the local browser application.

## Install

```bash
uv sync --frozen
```

## Commands

Cache AlphaFold data once, then prepare either statistics or a completed GSEA delivery:

```bash
uv run proptm3d cache structures MOUSE
uv run proptm3d cache context MOUSE
uv run proptm3d cache clean MOUSE    # remove only the MOUSE AlphaFold cache
uv run proptm3d cache                # show commands and local cache availability
uv run proptm3d prepare stats DPA
uv run proptm3d prepare gsea DPA --input /path/to/PTM_complete.zip
uv run proptm3d serve DPA          # http://127.0.0.1:8000/
uv run proptm3d clean DPA          # remove only the prepared DPA package
uv run proptm3d clean              # remove all three prepared packages
```

`prepare stats` reads `./PTM_statistics.h5mu` by default and also accepts a statistics delivery ZIP through `--input`. `prepare gsea` requires `--input` with a completed PTM delivery ZIP. Both commands accept DPA, DPU, or CF-DPU; omitting the method prepares all three. They write to `./output_3d` unless `--output-dir` is given. `serve` accepts `--port` and requires exactly one method. `clean` preserves the input, shared cache, and unrecognized directories.

The default `output_3d` is relative to the directory where you run the command, not to the input ZIP. `prepare` prints each method's absolute folder and its matching `serve` command. After deploying the browser build, `proptm3d serve DPA` serves only `output_3d/DPA` as the website root at `http://127.0.0.1:8000/`; choose DPU or CF-DPU to serve those folders instead.

The statistics delivery ZIP can be passed directly, for example:

```bash
uv run proptm3d prepare stats DPA \
  --input /path/to/PTM_HIF2a_mutant_vs_GFP_control_statistics.zip
```

`prepare stats` reads the archive's `PTM_statistics.h5mu` member and ignores `PTM_inputs.h5mu`. It exports quantification to `tables/measurements.parquet` and DEA results to `tables/site_stats.parquet`, plus the supporting site, protein, annotation, structure, and structural-context tables.

`prepare gsea` requires exactly one `PTM_results.h5mu` and at least one recognized GSEA result artifact for every selected method. It produces all the same statistics tables plus `tables/gsea_terms.parquet`, including term scores, FDRs, full member sequence windows, and leading-edge sequence windows. A statistics-only ZIP fails instead of producing a misleading GSEA package. Input members are extracted only temporarily; the ZIP remains unchanged.

In the current PTM pipeline layout, the statistics delivery contains `PTM_statistics.h5mu`. The completed delivery contains `PTM_results.h5mu` beside `PTM_DPA/`, `PTM_DPU/`, and `PTM_CF_DPU/`; their `result_ptm_sea.cbor.gz`, `result_kinase_gsea.cbor.gz`, and `result_mea.cbor.gz` artifacts are the validated inputs to `prepare gsea`.

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

Each method has its own directory under `output_3d`:

```text
DPA/
  index.html
  data/run.json
  data/plot_backgrounds.json            # after browser deployment
  data/plot_backgrounds/*.png            # after browser deployment
  tables/sites.parquet
  tables/site_stats.parquet
  tables/measurements.parquet
  tables/proteins.parquet
  tables/protein_features.parquet
  tables/structures.parquet
  tables/site_structural_context.parquet
  tables/gsea_terms.parquet               # prepare gsea only
  structures/                    # link to shared cached .cif.gz models
```

The manifest records the method, contrasts, samples and conditions, data release, archive version, file paths, and coverage counts. Preparation writes to a temporary directory and replaces a method package only after the export completes.

The site table retains every detected site, including those without an estimable effect. The statistics table uses `(protein_Id, site, contrast)` as its key. The DPU protein-only result rows are excluded from site statistics. The browser reads results and abundances from Parquet; no CBOR files are written to the served method directory. Deployment derives static black-point plot backgrounds from the results table.

`site_structural_context.parquet` contains pLDDT, the two PAE-aware neighbor counts, and the `is_exposed`/`is_idr` flags at every catalogued site position. Its key includes the AlphaFold model ID because long-protein fragments may overlap; proptm3d preserves each matching model instead of choosing one silently. Sites without context and residue mismatches remain present with an explicit `mapping_status`.

The DPU preparation summary counts distinct sites with a finite DPU fold change and FDR in at least one contrast, plus proteins and structures represented by those sites. It separately reports measured sites without a complete DPU result; those sites remain in the prepared catalog. The manifest records both the measured catalog counts and complete-result counts.

| Method | Plot effect and FDR | Per-sample evidence |
|---|---|---|
| DPA | Site `diff.site`, `FDR.site` | Aligned enriched site and total protein abundance |
| DPU | `diff_diff`, `FDR_I` | Aligned enriched site and total protein abundance |
| CF-DPU | CF `diff.site`, `FDR.site` | Enriched site, total protein, and corrected abundance |

Every method also carries original site and total-protein fold changes for the protein-versus-site scatter. Sample alignment uses `obs/Name`, and condition labels use `obs/G_`. Missing abundance stays null. The UniProt feature export retains sequence coordinates, their modifiers, descriptions, and evidence; proteins with unavailable or mismatched sequence annotation remain in the package with an explicit status.

## Development

```bash
make sync
make check
make docs
```

`make docs` builds the [Python documentation](docs/index.md) to `docs/_build/html/index.html` and treats warnings as errors. `make check` is the CI gate: Python formatting, imports, dependencies, tests, package build, browser checks and build, and documentation build. CI runs it on Python 3.13 and runs the Python tests separately on the supported minimum, Python 3.11. Tests stub external downloads. The active Python API and CLI prepare method-scoped packages from h5mu inputs; the retired Excel/CSV browser pipeline is no longer part of the package.
