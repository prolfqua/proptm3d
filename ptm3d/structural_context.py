"""
structural_context.py - Module for extracting residue-level structural annotations (pLDDT, pPSE side-chain exposure, IDR detection) inspired by Bludau et al. (PLoS Biology 2022).
"""

import os
import math
import pandas as pd

def parse_pdb_residues(pdb_path):
    """
    Parses CA (Alpha Carbon) atoms from a PDB file to extract residue sequence, 
    positions, coordinates, and pLDDT scores (stored in B-factor column).
    """
    residues = []
    if not os.path.exists(pdb_path):
        raise FileNotFoundError(f"PDB file not found: {pdb_path}")
        
    aa_3to1 = {
        'ALA':'A', 'CYS':'C', 'ASP':'D', 'GLU':'E', 'PHE':'F',
        'GLY':'G', 'HIS':'H', 'ILE':'I', 'LYS':'K', 'LEU':'L',
        'MET':'M', 'ASN':'N', 'PRO':'P', 'GLN':'Q', 'ARG':'R',
        'SER':'S', 'THR':'T', 'VAL':'V', 'TRP':'W', 'TYR':'Y'
    }
    
    with open(pdb_path, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            if line.startswith('ATOM  ') and line[12:16].strip() == 'CA':
                res_name3 = line[17:20].strip()
                res_aa = aa_3to1.get(res_name3, 'X')
                chain_id = line[21].strip()
                res_num = int(line[22:26].strip())
                x = float(line[30:38].strip())
                y = float(line[38:46].strip())
                z = float(line[46:54].strip())
                plddt = float(line[60:66].strip())  # B-factor in AlphaFold models = pLDDT
                
                residues.append({
                    'res_num': res_num,
                    'res_aa': res_aa,
                    'res_name3': res_name3,
                    'chain_id': chain_id,
                    'x': x, 'y': y, 'z': z,
                    'plddt': plddt
                })
                
    df = pd.DataFrame(residues)
    if not df.empty:
        df.drop_duplicates(subset=['res_num'], inplace=True)
        df.sort_values('res_num', inplace=True)
    return df

def calculate_ppse(res_df, radius=12.0):
    """
    Calculates prediction-aware part-sphere exposure (pPSE) per residue.
    Counts the number of C-alpha atoms within a specified radius (default 12.0 Å).
    High count -> buried/structured environment; Low count -> exposed side-chain.
    """
    if res_df.empty:
        return res_df
        
    coords = res_df[['x', 'y', 'z']].values
    n_res = len(coords)
    ppse_scores = []
    
    for i in range(n_res):
        cnt = 0
        xi, yi, zi = coords[i]
        for j in range(n_res):
            if i == j:
                continue
            xj, yj, zj = coords[j]
            dist = math.sqrt((xi - xj)**2 + (yi - yj)**2 + (zi - zj)**2)
            if dist <= radius:
                cnt += 1
        ppse_scores.append(cnt)
        
    res_df['ppse'] = ppse_scores
    return res_df

def annotate_structural_regions(res_df, plddt_window=5, ppse_window=5):
    """
    Annotates structured vs intrinsically disordered regions (IDRs) based on 
    smoothed pLDDT and pPSE exposure scores (Bludau et al., 2022).
    """
    if res_df.empty:
        return res_df
        
    res_df['plddt_smooth'] = res_df['plddt'].rolling(window=plddt_window, center=True, min_periods=1).mean()
    if 'ppse' in res_df.columns:
        res_df['ppse_smooth'] = res_df['ppse'].rolling(window=ppse_window, center=True, min_periods=1).mean()
    else:
        res_df['ppse_smooth'] = 0
        
    # IDR threshold: smoothed pLDDT < 70 (or < 50 for highly disordered)
    res_df['is_idr'] = res_df['plddt_smooth'] < 70.0
    res_df['is_deep_idr'] = res_df['plddt_smooth'] < 50.0
    
    # Classify exposure: low exposure (buried, ppse_smooth > 5) vs high exposure (surface, ppse_smooth <= 5)
    res_df['is_exposed'] = res_df['ppse_smooth'] <= 5.0
    
    return res_df
