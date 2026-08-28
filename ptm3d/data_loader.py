"""
data_loader.py - Data ingestion and normalization module for PTM 3D Visualizer.
"""

import os
import re
import pandas as pd

def parse_uniprot_accession(protein_str):
    """
    Extract clean UniProt accession from strings like 'sp|O14974|MYPT1_HUMAN' or 'O14974'.
    """
    if pd.isna(protein_str):
        return None
    protein_str = str(protein_str).strip()
    match = re.search(r'(?:sp|tr)\|([A-Z0-9]{6,10}(?:-\d+)?)\|', protein_str)
    if match:
        return match.group(1)
    # Direct accession match
    match_direct = re.match(r'^[A-Z0-9]{6,10}(?:-\d+)?$', protein_str)
    if match_direct:
        return match_direct.group(0)
    # Fallback split
    parts = protein_str.split('|')
    if len(parts) >= 2:
        return parts[1]
    return protein_str

def load_ptm_data(file_path, sheet_name=0):
    """
    Load PTM differential analysis results from Excel, CSV, or TSV file.
    Standardizes column names to internal schema.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")
    
    ext = os.path.splitext(file_path)[1].lower()
    if ext in ['.xlsx', '.xls']:
        df = pd.read_excel(file_path, sheet_name=sheet_name)
    elif ext == '.csv':
        df = pd.read_csv(file_path)
    elif ext in ['.tsv', '.txt']:
        df = pd.read_csv(file_path, sep='\t')
    else:
        raise ValueError(f"Unsupported file format: {ext}")
    
    # Map common column aliases
    col_mapping = {
        'protein_Id': 'raw_protein_id',
        'protein_id': 'raw_protein_id',
        'posInProtein': 'pos_in_protein',
        'position': 'pos_in_protein',
        'modAA': 'mod_aa',
        'diff.site': 'log2fc',
        'log2FC': 'log2fc',
        'logFC': 'log2fc',
        'FDR.site': 'fdr',
        'FDR': 'fdr',
        'p.value': 'p_value',
        'pvalue': 'p_value',
        'contrast': 'contrast',
        'gene_name': 'gene_name',
        'SequenceWindow': 'sequence_window',
        'site': 'site_name'
    }
    
    # Rename matching columns
    for orig_col, target_col in col_mapping.items():
        if orig_col in df.columns:
            df.rename(columns={orig_col: target_col}, inplace=True)
            
    # Clean UniProt accession
    if 'raw_protein_id' in df.columns:
        df['uniprot_acc'] = df['raw_protein_id'].apply(parse_uniprot_accession)
    elif 'uniprot_acc' not in df.columns:
        raise KeyError("Could not find protein identifier column (e.g. protein_Id / protein_id / uniprot_acc)")
        
    # Ensure pos_in_protein is numeric
    if 'pos_in_protein' in df.columns:
        df['pos_in_protein'] = pd.to_numeric(df['pos_in_protein'], errors='coerce')
        
    if 'log2fc' in df.columns:
        df['log2fc'] = pd.to_numeric(df['log2fc'], errors='coerce')
        
    if 'fdr' in df.columns:
        df['fdr'] = pd.to_numeric(df['fdr'], errors='coerce')
        
    return df

def filter_ptm_data(df, protein_acc=None, min_fdr=None, contrast=None):
    """
    Filter dataset by protein accession, FDR threshold, or contrast.
    """
    sub_df = df.copy()
    if protein_acc:
        sub_df = sub_df[sub_df['uniprot_acc'] == protein_acc]
    if contrast and 'contrast' in sub_df.columns:
        sub_df = sub_df[sub_df['contrast'] == contrast]
    if min_fdr is not None and 'fdr' in sub_df.columns:
        sub_df = sub_df[sub_df['fdr'] <= min_fdr]
    return sub_df
