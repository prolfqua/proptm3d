# proptm3d agent guide

`proptm3d` is a uv-managed Python package with a `src/` layout. Its public CLI prepares method-scoped browser data from either `PTM_statistics.h5mu` or a completed PTM delivery with GSEA results. The browser UI is the TypeScript/Vite app in [web/](web/); see [web/README.md](web/README.md) for its build and deployment commands and [the scenario plan](../TODO/proptm3d/TODO_no_enrichment_browser_app.md) for its data and view contract.

Precedence: the closest `AGENTS.md` wins for its own directory.

## Scoped AGENTS.md

| Scope | Guide |
|---|---|
| TypeScript frontend | [web/AGENTS.md](./web/AGENTS.md) |

## Commands

```bash
make sync          # uv sync --frozen --group dev
make test          # pytest with branch coverage, 90% gate
make test-web      # Type-check and test the TypeScript browser app
make format        # ruff format and autofix
make lint          # ruff check and import-linter
make deps          # deptry
make build         # uv build and twine check
make check         # all merge gates

uv run proptm3d cache structures MOUSE
uv run proptm3d cache context MOUSE
uv run proptm3d cache clean MOUSE
uv run proptm3d prepare stats DPA --input PTM_statistics.h5mu --output-dir output_3d
uv run proptm3d prepare gsea DPA --input PTM_delivery.zip --output-dir output_3d
uv run proptm3d serve DPA --output-dir output_3d --port 8000
uv run proptm3d clean DPA --output-dir output_3d

cd web && npm ci && npm run build && npm run deploy
```

The method names are `DPA`, `DPU`, and `CF-DPU`. Omitting the method from `prepare stats`, `prepare gsea`, or the top-level `clean` selects all three. `prepare gsea` requires a completed delivery ZIP containing GSEA results. `serve` requires one method. A bare `proptm3d` shows help. Cache downloads under `~/.cache/proptm3d` are shared; `cache clean HUMAN|MOUSE` removes only the selected organism's AlphaFold cache.

## Architecture

The import-linter contract in `pyproject.toml` enforces the main direction: CLI -> preparation/static serving -> extraction/cache modules. `prepared_data.py` must not import the legacy table loader, and `__init__.py` stays empty.

| Module | Responsibility |
|---|---|
| `cli.py` | Cyclopts `cache`, `prepare`, `clean`, and `serve` commands |
| `prepare.py` | Atomic method package export, manifests, Parquet tables, owned-directory cleanup |
| `gsea_data.py` | Validated, streaming extraction of completed GSEA stage artifacts into Polars tables |
| `structural_context_cache.py` | Archive-wide AlphaFold PAE/context precomputation and completed-cache loading |
| `prepared_data.py` | DPA/DPU/CF-DPU result selection, site catalog, aligned sample evidence |
| `uniprot_cache.py` | Whole-proteome UniProt sequence and feature cache, foreign accession mapping |
| `alphafold_cache.py` | AlphaFold archive download, compressed model extraction, foreign model fetch |
| `webapp.py` | Local static HTTP server for prepared method folders |
| `mudata_reader.py` | Low-level completed MuData record decoding |
| `uniprot_accession.py` | UniProt accession parsing shared by active preparation and older table utilities |
| `data_loader.py`, `protein_data.py`, and exporters | Standalone legacy utilities; not the active preparation or browser path |
| `web/src/` | Lit app, prepared-data loaders, Plotly charts, SVG logos, and 3Dmol structure viewer |

## Data and implementation rules

- Use Polars DataFrames, not pandas. `prepare stats` reads `PTM_statistics`; `prepare gsea` reads `PTM_results` plus the delivery ZIP's GSEA stage artifacts. Both require MuData schema `2.0.0` and fail clearly on unsupported input.
- Keep the public `proptm3d` executable and method names stable. Do not reintroduce the old default Excel/CSV CLI.
- Retain every measured real-protein site, including sites without a statistical estimate. Exclude reverse decoys with no UniProt identifier. Preserve `contam_sp|...` proteins.
- Key site results by `(protein_Id, site, contrast)`. The volcano uses the selected method's effect/FDR. The protein-versus-site scatter uses DPA original site and total-protein effects for every method.
- Align site, total-protein, and CF abundance by `obs/Name`; preserve `obs/G_` and missing values. Do not substitute zero for missing abundance.
- Download UniProt and selected AlphaFold models during preparation; download archive-wide PAE and compute residue context only during `cache context`. Every preparation requires and joins the completed structural-context cache. `serve` exposes static files through GET/HEAD and performs no external request. Keep cache files outside `output_3d`.
- Do not apply canonical feature coordinates to an isoform without an explicit mapping. Record sequence mismatch status when UniProt residues disagree with PTM site coordinates.
- `clean` and replacement may modify only method directories carrying a `proptm3d-prepared-method` manifest. A failed preparation must leave a previous method package usable.
- Stub external network calls in tests. `make check` is the complete quality gate. Declare dependencies in `pyproject.toml` and keep `uv.lock` current.
- Add user-visible Python changes under the current version heading in `CHANGELOG.md`.

The older JavaScript app and browser tests are archived in [legacy/legacy-browser-2026-09-23.zip](legacy/legacy-browser-2026-09-23.zip) and are not active development sources. The TypeScript app consumes the Parquet tables described in `data/run.json`; do not reopen or port the archived frontend while developing it. Python preparation and static serving are separate from routine browser UI work; change preparation when the user changes the prepared-data contract.
