"""
structure_fetcher.py - Module for fetching and caching 3D protein structures from AlphaFold DB and RCSB PDB.
"""

import os
import requests
import json

DEFAULT_CACHE_DIR = os.path.join(os.path.expanduser('~'), '.cache', 'ptm3d_structures')

def get_alphafold_model_info(uniprot_acc):
    """
    Queries AlphaFold DB API to retrieve model metadata and direct PDB/CIF download URLs.
    """
    clean_acc = uniprot_acc.split('-')[0].strip()
    url = f"https://alphafold.ebi.ac.uk/api/prediction/{clean_acc}"
    try:
        resp = requests.get(url, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list) and len(data) > 0:
                return data[0]
    except Exception as e:
        print(f"Error querying AlphaFold API for {uniprot_acc}: {e}")
    return None

def fetch_structure(uniprot_acc, cache_dir=DEFAULT_CACHE_DIR, format='pdb'):
    """
    Downloads PDB file for a UniProt accession from AlphaFold DB.
    Returns path to local cached file.
    """
    os.makedirs(cache_dir, exist_ok=True)
    clean_acc = uniprot_acc.split('-')[0].strip()
    target_file = os.path.join(cache_dir, f"{clean_acc}.{format}")
    
    if os.path.exists(target_file) and os.path.getsize(target_file) > 0:
        return target_file
        
    info = get_alphafold_model_info(clean_acc)
    if not info:
        raise RuntimeError(f"Could not retrieve AlphaFold model metadata for {clean_acc}")
        
    url_key = 'pdbUrl' if format == 'pdb' else 'cifUrl'
    download_url = info.get(url_key)
    if not download_url:
        raise ValueError(f"No {format} URL found in AlphaFold DB response for {clean_acc}")
        
    print(f"Downloading {clean_acc} structure from {download_url}...")
    resp = requests.get(download_url, timeout=30)
    if resp.status_code == 200:
        with open(target_file, 'w', encoding='utf-8') as f:
            f.write(resp.text)
        return target_file
    else:
        raise RuntimeError(f"Failed to download structure from {download_url} (HTTP {resp.status_code})")
