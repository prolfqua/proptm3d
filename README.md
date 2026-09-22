# proptm3d

`proptm3d` prepares phosphorylation statistics from `PTM_statistics.h5mu` for a local browser application. This is the Python preparation stage of the [no-enrichment browser plan](../TODO/proptm3d/TODO_no_enrichment_browser_app.md). The interactive browser view is still to be implemented; `serve` currently displays a preparation status page and exposes the generated files.

## Install

```bash
uv sync --frozen
```

## Commands

Run beside `PTM_statistics.h5mu`:

```bash
uv run proptm3d prepare             # DPA, DPU, and CF-DPU
uv run proptm3d serve DPA          # http://127.0.0.1:8000/
uv run proptm3d clean DPA          # remove only the prepared DPA package
uv run proptm3d clean              # remove all three prepared packages
```

All commands accept `--output-dir PATH` (default `./output_3d`). `prepare` accepts `--input PATH` (default `./PTM_statistics.h5mu`). `serve` accepts `--port` (default 8000) and requires exactly one method. A bare `proptm3d` prints command help. `clean` preserves the input, the shared external-data cache, and unrecognized directories.

In the current PTM pipeline layout, this h5mu sits beside `PTM_DPA/`, `PTM_DPU/`, and `PTM_CF_DPU/`. Those folders hold separate `intermediate_*.cbor.gz` files for downstream enrichment stages. Scenario 1 uses only the statistics h5mu; enrichment inputs belong to later browser scenarios.

Preparation downloads the main organism's UniProt reference proteome and AlphaFold archive into `~/.cache/proptm3d` when absent. It currently recognizes predominantly mouse and human input from the FASTA entry names, and refuses ambiguous organism or isoform coordinates. The compressed AlphaFold proteome archives are several GiB. UniProt feature data, compressed mmCIF models, and a small number of foreign-species models are acquired during `prepare`; `serve` performs no external requests.

## Generated package

Each method has its own directory under `output_3d`:

```text
DPA/
  index.html
  data/run.json
  data/proteins.cbor
  data/site_index.cbor
  data/proteins/<accession>.cbor
  data/evidence/<accession>.cbor
  data/features/<accession>.cbor
  tables/sites.parquet
  tables/site_stats.parquet
  tables/measurements.parquet
  tables/proteins.parquet
  tables/protein_features.parquet
  structures/                    # link to shared cached .cif.gz models
```

The manifest records the method, contrasts, samples and conditions, data release, archive version, file paths, and coverage counts. Preparation writes to a temporary directory and replaces a method package only after the export completes.

The site table retains every detected site, including those without an estimable effect. The statistics table uses `(protein_Id, site, contrast)` as its key. The DPU protein-only result rows are excluded from site statistics. `site_index.cbor` carries method effects and FDRs for the Find plots; each per-protein CBOR contains all measured sites and its result rows across contrasts.

| Method | Plot effect and FDR | Per-sample evidence |
|---|---|---|
| DPA | Site `diff.site`, `FDR.site` | Enriched site abundance |
| DPU | `diff_diff`, `FDR_I` | Aligned enriched site and total protein abundance |
| CF-DPU | CF `diff.site`, `FDR.site` | Enriched site, total protein, and corrected abundance |

Every method also carries original site and total-protein fold changes for the protein-versus-site scatter. Sample alignment uses `obs/Name`, and condition labels use `obs/G_`. Missing abundance stays null. The UniProt feature export retains sequence coordinates, their modifiers, descriptions, and evidence; proteins with unavailable or mismatched sequence annotation remain in the package with an explicit status.

## Development

```bash
make check
```

Tests stub external downloads. The older Excel/CSV pipeline remains available as a Python API in `proptm3d.pipeline` during the browser migration, but the public CLI uses the h5mu preparation workflow above.
