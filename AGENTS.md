# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`ptm3d` maps differential PTM quantification results (e.g. from `prophosqua`) onto 3D protein structures fetched
from AlphaFold DB. The pipeline writes **data files** (per-protein JSON under `data/`, `data/catalog.json`, cached
PDB models under `structures/`) plus PyMOL `.pml` scripts; the primary visualization is a static single-page JS app
(`index.html` + `app.js`, shipped as package assets and copied into the output directory) that fetches those files
in the browser. `ptm3d serve <dir>` serves an output directory locally. A second, kept-for-now path writes
self-contained `<gene>_<acc>_3d.html` dashboards with embedded data (default on; `--no-html` to skip).

It is a uv-managed Python package (src layout, `uv_build` backend) modeled on the FGCZ Python project reference
(`fgcz_python_project_reference`), providing the `ptm3d` console script.

## Commands

The Makefile follows the `anndata_bridge/python_package_template` convention (uv + `.venv/bin` tools):

```bash
make sync         # uv sync --frozen --group dev
make test         # pytest with branch coverage (90% gate)
make format       # ruff format + autofix
make lint         # ruff check + lint-imports (dependency-direction contract)
make deps         # deptry dependency validation
make build        # uv build + twine check
make check        # every merge-blocking gate (lock check + all of the above)
make clean        # remove build/cache artifacts

uv run pytest tests/test_data_loader.py   # single test file
uv run ptm3d --input <results.xlsx> --output_dir output_3d --max_proteins 10
uv run ptm3d serve output_3d --port 8000  # serve the app at http://127.0.0.1:8000/
```

## Architecture

Code lives in `src/ptm3d/`. `__init__.py` is intentionally empty — import from concrete modules.

Dependency direction is `cli -> pipeline -> leaf modules`, enforced by the Import Linter layers contract in
`pyproject.toml` (`uv run lint-imports`). The leaf modules are independent of each other.

| Module | Responsibility |
|---|---|
| `cli.py` | cyclopts boundary (`ptm3d` console script): the default pipeline command and the `serve` subcommand |
| `pipeline.py` | End-to-end orchestration: select proteins, run the leaf steps, collect `ProteinReport`s, write catalog + app |
| `data_loader.py` | Load Excel/CSV/TSV PTM results, map column aliases (`protein_Id`, `diff.site`, `FDR.site`, ...) to the internal schema (`uniprot_acc`, `pos_in_protein`, `log2fc`, `fdr`, ...) |
| `structure_fetcher.py` | AlphaFold DB API access and PDB caching; raises `StructureFetchError` on any retrieval failure |
| `structural_context.py` | Parse CA atoms from PDB (pLDDT is in the B-factor column), CA-neighbor exposure score (`ppse`), IDR annotation |
| `payload_io.py` | `PayloadWriter` protocol, `JsonPayloadWriter`/`CborPayloadWriter`, and the `payload_writer_for` factory — the format decision is made once at the CLI and injected |
| `enrichment_loader.py` | Parses the string_gsea GSEAResult JSONs prophosqua writes (`--enrichment`), matches member sequence windows against the PTM table (N:M via the canonical upper-case window), and builds the compact `data/categories.*` index (per contrast: window/protein lists, terms with index references and leading-edge + full-set site counts) |
| `protein_data.py` | Builds the per-protein data payloads (dicts); serialization is the injected writer's job |
| `web_visualizer.py` | Standalone self-contained HTML dashboards (embedded data); reuses `protein_data.build_ptm_records` (declared one-way edge) |
| `pymol_exporter.py` | `.pml` scripts coloring PTM residues by log2FC on a green-white-red scale |
| `webapp.py` | `ProteinReport`, the `data/catalog.*` writer, copying the static app assets, and the local HTTP server |
| `assets/` | Two static browser apps: `index.html`+`app.js` (classic cards) and `lit.html`+`lit-app.js` (Lit + Tabulator table view), sharing `payload.js` (fetch/decode, cbor-x), `color.js`, `viewer3d.js`; `vendor/` holds pinned CDN re-export shims (lit 3.2.1, cbor-x 1.6.6, tabulator 6.5.2 — same stack as BioBeamer/rawDIAGQC) |

Tests in `tests/` stub all network access (`structure_fetcher.requests` or `pipeline.fetch_structure` are
monkeypatched) and build synthetic PDB content via the `conftest.py` fixtures.

## Key Constraints

- The internal column schema (`uniprot_acc`, `pos_in_protein`, `mod_aa`, `log2fc`, `fdr`, `contrast`, `gene_name`,
  `sequence_window`) is shared across all modules — keep names consistent when extending the loader or visualizers.
- DataFrames are polars (`pl.DataFrame`) throughout; do not reintroduce pandas. Excel reading goes through
  `fastexcel` (polars' `read_excel` engine); tests write xlsx via `xlsxwriter` (dev dependency).
- CLI is cyclopts (`cli.app`); it exits via `SystemExit` with the command's return code, which the CLI tests expect.
- Coverage gate: 90% (`fail_under` in pyproject); lint gates: `ruff check`, `ruff format --check`, `lint-imports`.
- Keep `src/ptm3d/__init__.py` empty; import from concrete modules.
- The pipeline skips a protein only on `StructureFetchError`; all other errors must propagate. Do not add broad
  exception handlers.
- Protein selection default: **all proteins with at least one significant site**; `--max_proteins` is the explicit
  testing/limit cap. The catalog carries per-contrast stats (`contrast_stats`) for the app's contrast dropdown.
- Enrichment member matching is an exact match on the canonical upper-case sequence window. Windows trimmed to
  11/13-mers (PTM-SEA `trim_to < 15`) will not match the 15-mer table windows — the term then shows 0 sites in the
  category table rather than failing.
- Data and visualization stay separate: Python builds payloads and a `PayloadWriter` (CBOR default, JSON via
  `--format json`) serializes them; all rendering logic lives in `assets/`. The apps' external requests are the
  3Dmol.js script from `https://3dmol.org` and the pinned jsdelivr modules re-exported by `vendor/`; the data files
  are fetched relative to the served output root, so the output directory must be viewed over HTTP (`ptm3d serve`),
  not via `file://`. The file extension (`.json`/`.cbor`) is the decode contract in `payload.js`.
- Do not branch on a format name outside `payload_io.payload_writer_for`; pass the writer down instead.
- Tests must not touch the network; `structure_fetcher` downloads are cached, so real runs reuse the cache
  directory rather than re-downloading.
- The `ppse` metric is a simple CA-within-12-Å neighbor count, not the full prediction-aware part-sphere exposure
  from Bludau et al. (2022) — do not present it as equivalent.
- uv and `uv.lock` are the only dependency workflow; declare dependencies in `pyproject.toml`, never add
  `requirements.txt`.
- Record user-visible changes under `Unreleased` in `CHANGELOG.md`.
- `output_3d/` and `PTM_*_PTManalysis/` are ignored by git (`output_3d/` currently still has tracked example files
  from the initial commit).

## Workspace Context

This repo is part of the prolfqua ecosystem workspace (`/Users/wolski/projects/prolfqua_fml`); the workspace-level
AGENTS.md conventions (changelog discipline, scope discipline, no ad hoc installs) apply. Input data typically comes
from `prophosqua` / `ptm-pipeline` PTM analysis output.
