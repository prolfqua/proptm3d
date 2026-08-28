"""
cli.py - Command Line Interface for ptm3d Visualizer.
"""

import os
import argparse
import pandas as pd

from .data_loader import load_ptm_data, filter_ptm_data
from .structure_fetcher import fetch_structure
from .structural_context import parse_pdb_residues, calculate_ppse, annotate_structural_regions
from .web_visualizer import generate_interactive_html
from .pymol_exporter import generate_pymol_script

def run_ptm3d_pipeline(input_file, output_dir, max_proteins=10, min_fdr=0.05, target_proteins=None):
    """
    Runs the end-to-end 3D PTM & log2FC visualizer pipeline for dataset.
    """
    os.makedirs(output_dir, exist_ok=True)
    print(f"--> Loading PTM results from {input_file}...")
    df = load_ptm_data(input_file)
    print(f"Loaded {len(df)} PTM records across {df['uniprot_acc'].nunique()} proteins.")
    
    # Determine target proteins to visualize
    if target_proteins:
        targets = [t.strip() for t in target_proteins]
    else:
        # Sort proteins by number of significant PTM sites
        sig_df = df[df['fdr'] <= min_fdr] if 'fdr' in df.columns else df
        top_counts = sig_df['uniprot_acc'].value_counts()
        targets = top_counts.index.tolist()[:max_proteins]
        
    print(f"--> Processing {len(targets)} target protein(s): {targets}")
    
    generated_reports = []
    
    for acc in targets:
        prot_df = filter_ptm_data(df, protein_acc=acc)
        if prot_df.empty:
            print(f"Skipping {acc}: no PTM records found.")
            continue
            
        gene_name = prot_df['gene_name'].dropna().iloc[0] if 'gene_name' in prot_df.columns and not prot_df['gene_name'].dropna().empty else acc
        
        print(f"\nProcessing {gene_name} ({acc}) with {len(prot_df)} PTM sites...")
        
        try:
            # 1. Fetch AlphaFold structure
            pdb_path = fetch_structure(acc, cache_dir=os.path.join(output_dir, 'structures'))
            
            # 2. Extract structural metrics
            res_df = parse_pdb_residues(pdb_path)
            res_df = calculate_ppse(res_df)
            res_df = annotate_structural_regions(res_df)
            
            # 3. Generate Interactive HTML Visualizer
            html_filename = f"{gene_name}_{acc}_3d.html"
            html_path = os.path.join(output_dir, html_filename)
            generate_interactive_html(pdb_path, prot_df, res_df, html_path, protein_acc=acc, gene_name=gene_name)
            
            # 4. Generate PyMOL script
            pml_filename = f"{gene_name}_{acc}_pymol.pml"
            pml_path = os.path.join(output_dir, pml_filename)
            generate_pymol_script(pdb_path, prot_df, pml_path, protein_name=gene_name)
            
            generated_reports.append({
                'gene_name': gene_name,
                'uniprot_acc': acc,
                'ptm_count': len(prot_df),
                'sig_count': len(prot_df[prot_df['fdr'] <= min_fdr]) if 'fdr' in prot_df.columns else 0,
                'html_file': html_filename,
                'pml_file': pml_filename
            })
            print(f"  [+] Saved HTML: {html_path}")
            print(f"  [+] Saved PyMOL: {pml_path}")
            
        except Exception as e:
            print(f"  [!] Error processing {acc}: {e}")
            
    # Generate Master Index Page
    generate_master_index(output_dir, generated_reports)
    print(f"\nDone! Master 3D PTM report index generated at: {os.path.join(output_dir, 'index_3d.html')}")

def generate_master_index(output_dir, reports):
    """
    Generates a master index.html page linking all generated protein 3D visualizers.
    """
    rows_html = []
    for r in reports:
        rows_html.append(f"""
        <tr>
            <td><strong>{r['gene_name']}</strong></td>
            <td><code>{r['uniprot_acc']}</code></td>
            <td>{r['ptm_count']}</td>
            <td><span class="badge">{r['sig_count']}</span></td>
            <td>
                <a href="{r['html_file']}" target="_blank" class="btn">View 3D Dashboard</a>
                <a href="{r['pml_file']}" download class="btn btn-secondary">Download PyMOL Script</a>
            </td>
        </tr>
        """)
        
    index_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>3D PTM & log2FC Proteome Visualizer Catalog</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
        body {{ font-family: 'Inter', sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; }}
        h1 {{ font-size: 1.8rem; margin-bottom: 0.5rem; color: #38bdf8; }}
        p {{ color: #94a3b8; margin-bottom: 1.5rem; }}
        table {{ width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; }}
        th, td {{ padding: 0.8rem 1rem; text-align: left; border-bottom: 1px solid #334155; }}
        th {{ background: #0b0f19; color: #94a3b8; text-transform: uppercase; font-size: 0.75rem; }}
        .badge {{ background: #ef4444; color: #fff; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem; font-weight: 600; }}
        .btn {{ background: #0284c7; color: white; padding: 5px 12px; text-decoration: none; border-radius: 4px; font-size: 0.85rem; font-weight: 600; margin-right: 5px; }}
        .btn:hover {{ background: #0369a1; }}
        .btn-secondary {{ background: #475569; }}
        .btn-secondary:hover {{ background: #334155; }}
    </style>
</head>
<body>
    <h1>3D PTM & log2-Fold-Change Proteome Catalog</h1>
    <p>AlphaFold DB 3D Protein Structure Integration for Differential PTM Profiling (FGCZ / prophosqua)</p>
    <table>
        <thead>
            <tr>
                <th>Gene</th>
                <th>UniProt Accession</th>
                <th>Total PTM Sites</th>
                <th>Significant Sites (FDR &lt; 0.05)</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody>
            {"".join(rows_html)}
        </tbody>
    </table>
</body>
</html>
"""
    with open(os.path.join(output_dir, 'index_3d.html'), 'w', encoding='utf-8') as f:
        f.write(index_html)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="3D PTM & log2-Fold-Change Visualizer")
    parser.add_argument('--input', '-i', required=True, help="Path to PTM results Excel/CSV file")
    parser.add_argument('--output_dir', '-o', default="output_3d", help="Directory for output HTML and PyMOL files")
    parser.add_argument('--max_proteins', '-m', type=int, default=10, help="Maximum number of top proteins to process")
    parser.add_argument('--proteins', '-p', nargs='+', help="Specific UniProt accessions to process")
    
    args = parser.parse_args()
    run_ptm3d_pipeline(args.input, args.output_dir, max_proteins=args.max_proteins, target_proteins=args.proteins)
