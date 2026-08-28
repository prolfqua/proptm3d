# PTMvisualizer (`ptm3d`) 🧬✨

**3D Protein Post-Translational Modification & $\text{log}_2\text{FC}$ Visualizer**

`PTMvisualizer` (`ptm3d`) is a computational toolkit designed to bridge the gap between quantitative mass spectrometry proteomics (e.g. phosphoproteomics) and 3D protein structures. It ingests differential PTM quantification results (from pipelines such as **FGCZ `prophosqua`**) and maps identified modification sites along with their **$\text{log}_2$-fold-changes ($\text{log}_2\text{FC}$)** and **significance (FDR)** directly onto 3D atomic structures from **AlphaFold DB** and **RCSB PDB**.

This project implements structural context metrics and visual principles inspired by **Isabell Bludau et al. (*PLoS Biology*, 2022)** (*"The structural context of posttranslational modifications at a proteome-wide scale"*).

---

## 🌟 Key Features

- 🧬 **Automatic 3D Structure Retrieval**: Queries the EBI AlphaFold DB API (`https://alphafold.ebi.ac.uk/api/prediction/<uniprot_acc>`) to fetch full-length predicted 3D structure models with local caching.
- 🎨 **AlphaFold Confidence ($\text{pLDDT}$) Backbone Color Scheme (Default)**:
  - 🟦 **Dark Blue**: Very High confidence ($\text{pLDDT} > 90$)
  - 🩵 **Cyan**: Confident ($70 < \text{pLDDT} \le 90$)
  - 💛 **Yellow**: Low confidence ($50 < \text{pLDDT} \le 70$)
  - 🟧 **Orange**: Very Low confidence / IDR ($\text{pLDDT} \le 50$)
  - *(Includes a dropdown selector in the sidebar to switch to N-to-C Rainbow Spectrum or Monochrome Slate).*
- 🔴 **$\text{log}_2\text{FC}$ PTM Site Visual Encoding**: Renders PTM sites as 3D spheres at their exact $(x, y, z)$ residue coordinates with text callouts, color-coded by $\text{log}_2\text{FC}$:
  - 🔵 **Blue**: Down-regulated modification ($\text{log}_2\text{FC} < 0$)
  - ⚪ **White**: Unchanged modification ($\text{log}_2\text{FC} = 0$)
  - 🔴 **Red**: Up-regulated modification ($\text{log}_2\text{FC} > 0$)
- 🔄 **Dual 1D-3D Synchronization**: Interactive 1D N-to-C linear sequence track linked to the 3D structure viewer. Clicking or hovering over any PTM site on the 1D track automatically centers, zooms, and highlights the corresponding residue in 3D.
- 📊 **Multi-Contrast Dropdown**: Switch dynamically between different experimental condition comparisons (e.g. `ConditionA_vs_Control` vs `ConditionB_vs_Control`) in the interactive HTML dashboard.
- 🔬 **Structural Context Annotations**: Integrates AlphaFold $\text{pLDDT}$ confidence scores, prediction-aware part-sphere exposure ($\text{pPSE}$), and disordered region / activation loop detection.
- 📸 **PyMOL Publishing Pipeline**: Programmatically generates standalone `.pml` scripts for rendering publication-ready 300+ DPI ray-traced figures in PyMOL.
- 📂 **Proteome Catalog Index**: Automatically builds a master catalog (`index_3d.html`) linking all processed protein visualizers.

---

## 🚀 Quick Start

### 1. Prerequisites & Installation

Ensure you have Python 3.8+ installed. Install required dependencies:

```bash
pip install pandas openpyxl requests jinja2
```

### 2. Run from Command Line (CLI)

#### Process Top Significant Proteins in a Dataset:
```bash
python3 -m ptm3d.cli --input PTM_o42260_PTManalysis/PTM_CF_DPU/CorrectFirst_PTM_usage_results.xlsx --output_dir output_3d --max_proteins 10
```

#### Process Specific Target Proteins by UniProt Accession:
```bash
python3 -m ptm3d.cli --input PTM_o42260_PTManalysis/PTM_CF_DPU/CorrectFirst_PTM_usage_results.xlsx --output_dir output_3d --proteins P28482 P12270 O60343
```

#### How Protein Selection & Multi-Contrasts Work:
- **Automatic Selection (`--max_proteins`)**: By default, `ptm3d` filters the dataset for statistically significant modifications ($\text{FDR} \le 0.05$) and ranks proteins by their total count of significant PTM sites, selecting the top $N$ proteins.
- **Multi-Contrast Inclusion**: Once a protein is selected, `ptm3d` automatically includes **all condition contrasts** for that protein in the interactive HTML report. Users can toggle between contrasts using the dropdown selector in the sidebar.

---

## 🐍 Python API Usage

You can also import `ptm3d` directly into your custom Python scripts or Jupyter notebooks:

```python
import ptm3d

# 1. Load and filter PTM dataset
df = ptm3d.load_ptm_data("PTM_o42260_PTManalysis/PTM_CF_DPU/CorrectFirst_PTM_usage_results.xlsx")
mapk1_df = ptm3d.filter_ptm_data(df, protein_acc="P28482")

# 2. Fetch AlphaFold 3D structure
pdb_path = ptm3d.fetch_structure("P28482", cache_dir="output_3d/structures")

# 3. Compute structural metrics (pLDDT, pPSE side-chain exposure, IDRs)
res_df = ptm3d.parse_pdb_residues(pdb_path)
res_df = ptm3d.calculate_ppse(res_df)
res_df = ptm3d.annotate_structural_regions(res_df)

# 4. Generate Interactive 3D HTML Visualizer
ptm3d.generate_interactive_html(
    pdb_path=pdb_path,
    ptm_df=mapk1_df,
    res_df=res_df,
    output_html_path="output_3d/MAPK1_P28482_3d.html",
    protein_acc="P28482",
    gene_name="MAPK1"
)

# 5. Generate PyMOL script for publication figures
ptm3d.generate_pymol_script(
    pdb_path=pdb_path,
    ptm_df=mapk1_df,
    output_pml_path="output_3d/MAPK1_P28482_pymol.pml",
    protein_name="MAPK1"
)
```

---

## 📁 Input Data Schema

The `ptm3d` data loader automatically standardizes common output columns from `prophosqua`, MaxQuant, FragPipe, Spectronaut, or custom Excel/CSV/TSV files. Supported column mappings:

| Input Column Name | Standard Field | Description |
| :--- | :--- | :--- |
| `protein_Id`, `protein_id` | `uniprot_acc` | UniProt Accession (e.g. `sp\|P28482\|MK01_HUMAN` or `P28482`) |
| `posInProtein`, `position` | `pos_in_protein` | 1-indexed amino acid residue position |
| `modAA` | `mod_aa` | Modified amino acid single-letter code (e.g. `S`, `T`, `Y`, `K`) |
| `diff.site`, `log2FC`, `logFC` | `log2fc` | Quantitative $\text{log}_2$-fold-change between conditions |
| `FDR.site`, `FDR` | `fdr` | False Discovery Rate / adjusted p-value |
| `contrast` | `contrast` | Condition comparison name (e.g., `DF10_bFGF_vs_DF10`) |
| `gene_name` | `gene_name` | Gene symbol (e.g., `MAPK1`) |
| `SequenceWindow` | `sequence_window` | Peptide sequence window surrounding modification site |

---

## 📂 Output Folder Structure

Running the pipeline populates the specified `--output_dir` (e.g., `output_3d/`):

```
output_3d/
├── index_3d.html               # Master catalog index linking all processed proteins
├── MAPK1_P28482_3d.html        # Interactive 3Dmol.js + 1D N-to-C dashboard for MAPK1
├── MAPK1_P28482_pymol.pml      # PyMOL script for high-res rendering
├── TPR_P12270_3d.html          # Interactive dashboard for TPR
├── TPR_P12270_pymol.pml        # PyMOL script for TPR
└── structures/                 # Local cache of downloaded AlphaFold DB .pdb models
    ├── P28482.pdb
    └── P12270.pdb
```

---

## 🔬 Scientific Background & References

1. **Bludau I, Willems S, Zeng WF, Strauss MT, Hansen FM, Tanzer MC, Karayel O, Schulman BA, Mann M.** (2022). *The structural context of posttranslational modifications at a proteome-wide scale.* **PLoS Biol**, 20(5): e3001636. [doi:10.1371/journal.pbio.3001636](https://doi.org/10.1371/journal.pbio.3001636)
2. **Functional Genomics Center Zurich (FGCZ)**. *prophosqua R Package for Differential PTM Analysis.*
3. **Jumper J, et al.** (2021). *Highly accurate protein structure prediction with AlphaFold.* **Nature**, 596: 583–589.

---

## 📄 License

Apache License 2.0. Developed at Functional Genomics Center Zurich (FGCZ).
