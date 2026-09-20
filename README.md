# proptm3d

**3D Protein Post-Translational Modification & log2FC Visualizer**

`proptm3d` is a computational toolkit that bridges quantitative mass spectrometry proteomics (e.g. phosphoproteomics)
and 3D protein structures. It ingests differential PTM quantification results (from pipelines such as FGCZ
`prophosqua`) and maps identified modification sites, their log2-fold-changes (log2FC), and significance (FDR)
directly onto 3D atomic structures from AlphaFold DB.

The structural context metrics and visual principles are inspired by Bludau et al. (*PLoS Biology*, 2022),
*"The structural context of posttranslational modifications at a proteome-wide scale"*.

## Key Features

- **Automatic 3D structure retrieval**: queries the EBI AlphaFold DB API
  (`https://alphafold.ebi.ac.uk/api/prediction/<uniprot_acc>`) to fetch full-length predicted structure models,
  with local caching.
- **AlphaFold confidence (pLDDT) backbone coloring** (default): dark blue (pLDDT > 90, very high), cyan (70-90,
  confident), yellow (50-70, low), orange (<= 50, very low / disordered). A sidebar dropdown switches to an
  N-to-C rainbow spectrum or monochrome slate.
- **log2FC site encoding**: PTM sites are rendered as spheres at their residue coordinates with text callouts,
  colored on the classic green-white-red scale (green = down-regulated, white = unchanged, red = up-regulated),
  chosen to stay distinguishable from the blue/cyan pLDDT backbone coloring.
- **Linked 1D-3D views**: an N-to-C lollipop plot (log2FC per site along the sequence, one row per contrast) is
  synchronized with the 3D viewer and the site table; selecting a site anywhere centers and highlights it everywhere.
- **Multi-contrast dropdown**: switch between experimental condition comparisons (e.g. `ConditionA_vs_Control`
  vs `ConditionB_vs_Control`) within the app.
- **Structural context annotations**: AlphaFold pLDDT confidence, a CA-neighbor exposure score, and disordered
  region detection.
- **PyMOL export**: generates standalone `.pml` scripts for rendering publication-quality ray-traced figures in
  PyMOL.
- **Data/visualization separation**: the pipeline writes JSON + PDB data files; a static single-page JS app
  renders them in the browser, with a protein selector fed by `data/catalog.json` (`proptm3d serve`).

## Quick Start

### 1. Installation

Python 3.11+ is required. With [uv](https://docs.astral.sh/uv/):

```bash
uv sync            # development environment in .venv
# or install the package into another environment:
pip install .
```

### 2. Command line usage

Process every protein with a significant site (the default), then serve the result and open it in
the browser:

```bash
proptm3d --input PTM_results.xlsx --output_dir output_3d
proptm3d serve output_3d          # http://127.0.0.1:8000/
```

Cap the run to the top N proteins (quick looks, tests), or process specific UniProt accessions:

```bash
proptm3d --input PTM_results.xlsx --output_dir output_3d --max_proteins 10
proptm3d --input PTM_results.xlsx --output_dir output_3d --proteins P28482 P12270 O60343
```

Add the enrichment results the PTM pipeline writes (string_gsea GSEAResult JSON from PTM-SEA,
KinaseLib GSEA, and MEA) to get the category selector in the table view — pick a kinase or
signature, see the proteins and sites that are members, marked on the structure:

```bash
proptm3d --input PTM_results.xlsx --output_dir output_3d \
  --enrichment PTMSEA_DPA_results.json KinaseLib_GSEA_DPA.json MEA_DPA_results.json
```

(During development, prefix the commands with `uv run`.)

There are two visualization paths:

- **Data + browser app** (primary): the pipeline writes per-protein data files and a catalog under
  `data/` — CBOR by default, plain JSON with `--format json` — plus the cached AlphaFold PDB models
  under `structures/`. A static JS app (`index.html`, Lit + Tabulator + Plotly + 3Dmol, the rawDIAGQC
  stack) is copied into the output directory and fetches those files at view time, which is why the
  folder must be served over HTTP (`proptm3d serve`, or any static file server). Two workspaces:
  - **Find**: the enrichment categories (kinases, signatures, when `--enrichment` was given) and the
    protein table with header filters; selecting a category keeps only its member proteins; a row
    click opens the protein.
  - **Protein**: the PTM site table with header filters on the left; on the right one 3D panel per
    contrast and, below it, the N-to-C lollipop (sticks to each site's log2FC, heads colored like the
    spheres, dashed for imputed estimates, asterisks at the run's FDR threshold, a band at the
    protein-level log2FC). Selecting a site row, a sphere or a lollipop head highlights and centers
    that site everywhere. The contrast select in the toolbar scopes both workspaces.
- **Standalone HTML** (kept for the moment): self-contained `<gene>_<acc>_3d.html` dashboards with the
  data embedded, openable directly from disk without a server. Written by default; skip with
  `--no-html`.

PyMOL `.pml` scripts are written in both cases.

A small real dataset (mouse phospho, 20 proteins from a prophosqua `no_ERK_vs_ERK` analysis) ships in
`examples/` for a quick demo:

```bash
proptm3d --input examples/PTM_no_ERK_vs_ERK_top20.csv --output_dir output_3d --max_proteins 5
proptm3d serve output_3d
```

How protein selection and contrasts work:

- **Automatic selection**: by default, `proptm3d` filters the dataset for statistically significant
  modifications (FDR <= 0.05) and processes every protein with at least one significant site,
  ranked by significant-site count; `--max_proteins N` caps that to the top N.
- **Multi-contrast inclusion**: once a protein is selected, all condition contrasts for that protein are included
  in the interactive HTML report and can be toggled via the sidebar dropdown.

## Python API Usage

`proptm3d` can also be used directly from Python scripts or notebooks:

Import from the concrete modules (the package `__init__` is intentionally empty). All tables are
[polars](https://pola.rs) DataFrames:

```python
from proptm3d.data_loader import filter_ptm_data, load_ptm_data
from proptm3d.payload_io import JsonPayloadWriter
from proptm3d.protein_data import build_protein_payload
from proptm3d.pymol_exporter import generate_pymol_script
from proptm3d.structural_context import calculate_ppse, parse_pdb_residues
from proptm3d.structure_fetcher import fetch_structure

# 1. Load and filter PTM dataset
df = load_ptm_data("PTM_results.xlsx")
mapk1_df = filter_ptm_data(df, protein_acc="P28482")

# 2. Fetch AlphaFold 3D structure
pdb_path = fetch_structure("P28482", cache_dir="output_3d/structures")

# 3. Compute structural metrics (pLDDT, exposure)
res_df = parse_pdb_residues(pdb_path)
res_df = calculate_ppse(res_df)

# 4. Build and write the protein's data file for the browser app
payload = build_protein_payload(
    mapk1_df,
    res_df,
    protein_acc="P28482",
    gene_name="MAPK1",
    pdb_file="structures/P28482.pdb",
)
JsonPayloadWriter().write(payload, "output_3d/data/MAPK1_P28482")

# 5. Generate PyMOL script for publication figures
generate_pymol_script(
    pdb_path=pdb_path,
    ptm_df=mapk1_df,
    output_pml_path="output_3d/MAPK1_P28482_pymol.pml",
    protein_name="MAPK1",
)
```

## Development

```bash
make sync     # install the locked dev environment
make test     # tests with branch coverage
make format   # format + autofix
make check    # all merge-blocking gates (format, lint, deps, tests, build)
```

Run `make help` for the full target list.

## Input Data Schema

The data loader standardizes common output columns from `prophosqua`, MaxQuant, FragPipe, Spectronaut, or custom
Excel/CSV/TSV files. Supported column mappings:

| Input Column Name | Standard Field | Description |
| :--- | :--- | :--- |
| `protein_Id`, `protein_id` | `uniprot_acc` | UniProt accession (e.g. `sp\|P28482\|MK01_HUMAN` or `P28482`) |
| `posInProtein`, `position` | `pos_in_protein` | 1-indexed amino acid residue position |
| `modAA` | `mod_aa` | Modified amino acid single-letter code (e.g. `S`, `T`, `Y`, `K`) |
| `diff.site`, `log2FC`, `logFC` | `log2fc` | log2-fold-change between conditions |
| `FDR.site`, `FDR` | `fdr` | False discovery rate / adjusted p-value |
| `contrast` | `contrast` | Condition comparison name (e.g. `DF10_bFGF_vs_DF10`) |
| `gene_name` | `gene_name` | Gene symbol (e.g. `MAPK1`) |
| `SequenceWindow` | `sequence_window` | Peptide sequence window around the modification site |

## Output Folder Structure

Running the pipeline populates the specified `--output_dir` (e.g. `output_3d/`):

```
output_3d/
├── index.html                  # Static browser app (entry point)
├── app.js                      # Static browser app (logic; fetches the data files below)
├── data/
│   ├── catalog.json            # Run index: all processed proteins + their file names
│   ├── MAPK1_P28482.json       # Per-protein PTM records and structural annotations
│   └── TPR_P12270.json
├── MAPK1_P28482_pymol.pml      # PyMOL script for high-resolution rendering
├── TPR_P12270_pymol.pml
└── structures/                 # Cached AlphaFold DB .pdb models, fetched by the app
    ├── P28482.pdb
    └── P12270.pdb
```

Serve this folder over HTTP to use the app: `proptm3d serve output_3d [--port 8000]`.

## References

1. Bludau I, Willems S, Zeng WF, Strauss MT, Hansen FM, Tanzer MC, Karayel O, Schulman BA, Mann M (2022).
   *The structural context of posttranslational modifications at a proteome-wide scale.* PLoS Biol 20(5): e3001636.
   [doi:10.1371/journal.pbio.3001636](https://doi.org/10.1371/journal.pbio.3001636)
2. Functional Genomics Center Zurich (FGCZ). *prophosqua R package for differential PTM analysis.*
3. Jumper J, et al. (2021). *Highly accurate protein structure prediction with AlphaFold.* Nature 596: 583-589.

## License

Apache License 2.0. Developed at Functional Genomics Center Zurich (FGCZ).

## MuData input

Completed prophosqua `PTM_results.h5mu` files can supply both site statistics and embedded enrichment documents, before any Excel export:

```bash
proptm3d --input PTM_results.h5mu --sheet DPU --enrichment PTM_results.h5mu --output_dir output_3d
```

Select `DPA`, `DPU`, or `CF` with `--sheet`. DPU reads the protein-corrected effect and FDR. Incomplete stages fail at load time. Existing Excel/CSV/TSV and enrichment JSON inputs remain supported.
