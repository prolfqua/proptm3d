# proptm3d agent guide

`proptm3d` is a uv-managed Python package with a `src/` layout. Its public CLI prepares method-scoped browser data from `PTM_statistics.h5mu`. The interactive scenario 1 browser UI remains to be built; the current static `index.html` is a preparation status page. See [README.md](README.md) for usage and [the scenario plan](../TODO/proptm3d/TODO_no_enrichment_browser_app.md) for the intended views.

## Commands

```bash
make sync          # uv sync --frozen --group dev
make test          # pytest with branch coverage, 90% gate
make test-web      # Node tests for existing pure JS modules
make format        # ruff format and autofix
make lint          # ruff check and import-linter
make deps          # deptry
make build         # uv build and twine check
make check         # all merge gates

uv run proptm3d prepare DPA --input PTM_statistics.h5mu --output-dir output_3d
uv run proptm3d serve DPA --output-dir output_3d --port 8000
uv run proptm3d clean DPA --output-dir output_3d
```

The method names are `DPA`, `DPU`, and `CF-DPU`. Omitting the method from `prepare` or `clean` selects all three. `serve` requires one method. A bare `proptm3d` shows help. Cache downloads under `~/.cache/proptm3d` are shared and are never removed by the CLI clean command.

## Architecture

The import-linter contract in `pyproject.toml` enforces the main direction: CLI -> orchestration (`prepare.py` or the older `pipeline.py`) -> extraction/cache modules. `__init__.py` stays empty.

| Module | Responsibility |
|---|---|
| `cli.py` | Cyclopts `prepare`, `clean`, and `serve` commands |
| `prepare.py` | Atomic method package export, manifests, CBOR/Parquet, owned-directory cleanup |
| `prepared_data.py` | DPA/DPU/CF-DPU result selection, site catalog, aligned sample evidence |
| `uniprot_cache.py` | Whole-proteome UniProt sequence and feature cache, foreign accession mapping |
| `alphafold_cache.py` | AlphaFold archive download, compressed model extraction, foreign model fetch |
| `webapp.py` | Existing static HTTP server and legacy browser app helpers |
| `mudata_reader.py` | Low-level completed MuData record decoding, shared with the older pipeline |
| `pipeline.py`, `data_loader.py`, `protein_data.py`, and exporters | Older Excel/CSV Python API retained during the browser migration |

## Data and implementation rules

- Use Polars DataFrames, not pandas. Preparation reads the `PTM_statistics` MuData stage with schema `2.0.0`; fail clearly on unsupported input. The older Python pipeline reader still accepts `PTM_results`.
- Keep the public `proptm3d` executable and method names stable. Do not reintroduce the old default Excel/CSV CLI.
- Retain every measured real-protein site, including sites without a statistical estimate. Exclude reverse decoys with no UniProt identifier. Preserve `contam_sp|...` proteins.
- Key site results by `(protein_Id, site, contrast)`. The volcano uses the selected method's effect/FDR. The protein-versus-site scatter uses DPA original site and total-protein effects for every method.
- Align site, total-protein, and CF abundance by `obs/Name`; preserve `obs/G_` and missing values. Do not substitute zero for missing abundance.
- Download UniProt and AlphaFold data during `prepare` only. `serve` exposes static files through GET/HEAD and performs no external request. Keep cache files outside `output_3d`.
- Do not apply canonical feature coordinates to an isoform without an explicit mapping. Record sequence mismatch status when UniProt residues disagree with PTM site coordinates.
- `clean` and replacement may modify only method directories carrying a `proptm3d-prepared-method` manifest. A failed preparation must leave a previous method package usable.
- Stub external network calls in tests. `make check` is the complete quality gate. Declare dependencies in `pyproject.toml` and keep `uv.lock` current.
- Add user-visible Python changes under the current version heading in `CHANGELOG.md`.

The older JS app in `assets/` and its tests remain in the repo for migration work. The new browser must consume the prepared files described in `data/run.json`; do not copy the old app into a prepared directory before adapting its data contract.
