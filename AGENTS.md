# proptm3d agent guide

`proptm3d` is a uv-managed Python package with a `src/` layout. Its public CLI prepares method-scoped browser data from either `PTM_statistics.h5mu` or a completed PTM delivery with GSEA results. The browser UI is the TypeScript/Vite app in [web/](web/); see [web/README.md](web/README.md) for its build and deployment commands and [the scenario plan](../TODO/proptm3d/TODO_no_enrichment_browser_app.md) for its data and view contract.

Precedence: the closest `AGENTS.md` wins for its own directory.

## Scoped AGENTS.md

| Scope | Guide |
|---|---|
| TypeScript frontend | [web/AGENTS.md](./web/AGENTS.md) |

## Commands

```bash
make sync          # uv sync --frozen --group dev --group docs
make test          # pytest with branch coverage, 90% gate
make test-web      # Type-check and test the TypeScript browser app
make package-web   # Build browser sources into checked-in Python package assets
make test-deploy   # Verify the built assets and development-only deploy script
make format        # ruff format and autofix
make lint          # ruff check and import-linter
make deps          # deptry
make build         # uv build and twine check
make docs          # strict Sphinx HTML build in docs/_build/html
make check         # all merge gates

uv run proptm3d cache structures MOUSE
uv run proptm3d cache context MOUSE
uv run proptm3d cache clean MOUSE
uv run proptm3d prepare stats DPA /path/to/viewer --input PTM_statistics.h5mu
uv run proptm3d prepare gsea DPA /path/to/viewer --input PTM_delivery.zip
uv run proptm3d serve DPA /path/to/viewer --port 8000
uv run proptm3d serve /path/to/viewer
uv run proptm3d serve /path/to/viewer-DPA.zip
uv run proptm3d bundle DPA --in /path/to/viewer
uv run proptm3d bundle DPA DPU --in /path/to/viewer
uv run proptm3d bundle --in /path/to/viewer
uv run proptm3d clean /path/to/viewer

cd web && npm ci && cd .. && make package-web
```

The method names are `DPA`, `DPU`, and `CF-DPU`. Omitting the method from `prepare stats` or `prepare gsea` selects all three; both require a positional prepared folder and `--input`. Preparation writes the complete browser app and Python-rendered plot backgrounds. `serve FOLDER` shows the all-method chooser without changing the prepared root; `serve METHOD FOLDER` shows one method, and `serve BUNDLE.zip` extracts a ZIP temporarily. Bare `bundle` lists prepared-folder history; `bundle --in FOLDER` includes every prepared method, while positional methods select a subset. Bundles share referenced structure and PAE files under `shared/`. `clean FOLDER` deletes the whole validated root, never the input or shared cache. A bare `proptm3d` shows help. Cache downloads under `~/.cache/proptm3d` are shared; `cache clean HUMAN|MOUSE` removes only the selected organism's AlphaFold cache.

## Architecture

The exhaustive import-linter contract in `pyproject.toml` enforces the main direction: CLI -> preparation/bundling/static serving -> prepared-root/context boundaries -> extraction/cache modules. `__init__.py` stays empty.

| Module | Responsibility |
|---|---|
| `cli.py` | Cyclopts `cache`, `prepare`, `serve`, `bundle`, and `clean` commands |
| `prepare.py` | Atomic method package export, manifests, and Parquet tables |
| `browser_assets.py`, `plot_backgrounds.py` | Packaged static app installation and Python-rendered black-point plots |
| `prepared_history.py`, `prepared_root.py`, `bundle.py` | Prepared-root discovery, ownership checks, and portable ZIP export |
| `gsea_data.py` | Validated, streaming extraction of completed GSEA stage artifacts into Polars tables |
| `structural_context_cache.py` | Archive-wide AlphaFold PAE/context precomputation and completed-cache loading |
| `prepared_data.py` | DPA/DPU/CF-DPU result selection, site catalog, aligned sample evidence |
| `uniprot_cache.py` | Whole-proteome UniProt sequence and feature cache, foreign accession mapping |
| `alphafold_cache.py` | AlphaFold archive download, compressed model extraction, foreign model fetch |
| `webapp.py` | Local static HTTP server for prepared method folders |
| `uniprot_accession.py` | UniProt accession parsing for active preparation and annotation |
| `web/src/` | Lit app, prepared-data loaders, Plotly charts, SVG logos, and 3Dmol structure viewer |

## Data and implementation rules

- Use Polars DataFrames, not pandas. `prepare stats` reads `PTM_statistics`; `prepare gsea` reads `PTM_results` plus the delivery ZIP's GSEA stage artifacts. Both require MuData schema `2.0.0` and fail clearly on unsupported input.
- Keep the public `proptm3d` executable and method names stable. Do not reintroduce the old default Excel/CSV CLI.
- Retain every measured real-protein site, including sites without a statistical estimate. Exclude reverse decoys with no UniProt identifier. Preserve `contam_sp|...` proteins.
- Key site results by `(protein_Id, site, contrast)`. The volcano uses the selected method's effect/FDR. The protein-versus-site scatter uses DPA original site and total-protein effects for every method.
- Align site, total-protein, and CF abundance by `obs/Name`; preserve `obs/G_` and missing values. Do not substitute zero for missing abundance.
- Download UniProt and selected AlphaFold models during preparation; download archive-wide PAE and compute residue context only during `cache context`. Every preparation requires and joins the completed structural-context cache. `serve` exposes static files through GET/HEAD and performs no external request. Keep cache files outside the explicitly selected prepared root.
- Do not apply canonical feature coordinates to an isoform without an explicit mapping. Record sequence mismatch status when UniProt residues disagree with PTM site coordinates.
- `clean FOLDER` and method replacement remove generated contents only when every entry is recognized as owned. Never delete a stale `.METHOD.previous` backup automatically; it needs inspection. A failed publish must restore the previous method package. Bundles materialize only referenced cache files and require the browser app and `data/browser-assets.json` that Python preparation writes. Re-prepare old folders before bundling.
- The checked-in production build lives in `src/proptm3d/browser_static/`. Browser source/dependencies live in `web/`; `make package-web` refreshes the packaged build and `make check` verifies it. Normal `prepare`, `serve`, and `bundle` must not invoke Node/npm or download browser libraries.
- Stub external network calls in tests. `make check` is the complete quality gate. Declare dependencies in `pyproject.toml` and keep `uv.lock` current.
- Add user-visible Python changes under the current version heading in `CHANGELOG.md`.
- Keep the Python documentation in [docs/](docs/) and its warning-free build in `make check`; CI runs that gate on Python 3.13 plus Python tests on 3.11.

The older JavaScript app and browser tests are archived in [legacy/legacy-browser-2026-09-23.zip](legacy/legacy-browser-2026-09-23.zip) and are not active development sources. The TypeScript app consumes the Parquet tables described in `data/run.json`; do not reopen or port the archived frontend while developing it. Python preparation and static serving are separate from routine browser UI work; change preparation when the user changes the prepared-data contract.
