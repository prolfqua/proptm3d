"""
web_visualizer.py - Module for building interactive HTML dashboards combining 3Dmol.js 3D structure viewer with synchronized 1D N-to-C sequence tracks.
"""

import os
import json
import pandas as pd

def generate_interactive_html(pdb_path, ptm_df, res_df, output_html_path, protein_acc="UNKNOWN", gene_name="UNKNOWN"):
    """
    Generates a standalone, self-contained interactive HTML visualization report.
    Integrates 3Dmol.js for 3D protein structure view + synchronized 1D N-to-C sequence track.
    """
    os.makedirs(os.path.dirname(os.path.abspath(output_html_path)), exist_ok=True)
    
    # Read PDB file contents
    with open(pdb_path, 'r', encoding='utf-8', errors='ignore') as f:
        pdb_content = f.read()
        
    # Prepare PTM site JSON data
    valid_ptms = ptm_df.dropna(subset=['pos_in_protein', 'log2fc']).copy()
    ptm_list = []
    
    for idx, row in valid_ptms.iterrows():
        res_num = int(row['pos_in_protein'])
        log2fc = float(row['log2fc'])
        fdr = float(row.get('fdr', 1.0))
        p_val = float(row.get('p_value', 1.0))
        mod_aa = str(row.get('mod_aa', ''))
        site_name = str(row.get('site_name', f"{protein_acc}_{mod_aa}{res_num}"))
        seq_window = str(row.get('sequence_window', ''))
        contrast = str(row.get('contrast', 'Default'))
        
        # Color mapping (Diverging Blue-White-Red)
        if log2fc > 0:
            intensity = min(1.0, log2fc / 2.5)
            # Red gradient
            r_val = 255
            g_val = int(255 * (1 - intensity * 0.8))
            b_val = int(255 * (1 - intensity * 0.8))
        else:
            intensity = min(1.0, abs(log2fc) / 2.5)
            # Blue gradient
            r_val = int(255 * (1 - intensity * 0.8))
            g_val = int(255 * (1 - intensity * 0.8))
            b_val = 255
            
        hex_color = f"#{r_val:02x}{g_val:02x}{b_val:02x}"
        
        # Get pLDDT, exposure & 3D coordinates (x, y, z) from res_df if available
        plddt_val = None
        ppse_val = None
        x_val, y_val, z_val = None, None, None
        if not res_df.empty:
            match_res = res_df[res_df['res_num'] == res_num]
            if not match_res.empty:
                plddt_val = float(match_res['plddt'].values[0])
                x_val = float(match_res['x'].values[0])
                y_val = float(match_res['y'].values[0])
                z_val = float(match_res['z'].values[0])
                if 'ppse' in match_res.columns:
                    ppse_val = float(match_res['ppse'].values[0])
                    
        ptm_list.append({
            'res_num': res_num,
            'mod_aa': mod_aa,
            'log2fc': log2fc,
            'fdr': fdr,
            'p_value': p_val,
            'site_name': site_name,
            'seq_window': seq_window,
            'contrast': contrast,
            'color': hex_color,
            'plddt': plddt_val,
            'ppse': ppse_val,
            'x': x_val,
            'y': y_val,
            'z': z_val
        })
        
    # Get sequence details
    protein_seq = ""
    res_info_list = []
    if not res_df.empty:
        protein_seq = "".join(res_df['res_aa'].tolist())
        for idx, row in res_df.iterrows():
            res_info_list.append({
                'num': int(row['res_num']),
                'aa': str(row['res_aa']),
                'plddt': float(row['plddt']),
                'ppse': float(row.get('ppse', 0))
            })
            
    # Distinct contrasts list
    contrasts = sorted(list(set([p['contrast'] for p in ptm_list]))) if ptm_list else ["Default"]
    
    # HTML Template
    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>3D PTM & log2FC Visualizer - {gene_name} ({protein_acc})</title>
    <script src="https://3dmol.org/build/3Dmol-min.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        :root {{
            --bg-color: #0f172a;
            --card-bg: #1e293b;
            --accent-blue: #38bdf8;
            --accent-red: #f87171;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --border-color: #334155;
        }}
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            font-family: 'Inter', sans-serif;
            background-color: var(--bg-color);
            color: var(--text-main);
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }}
        header {{
            background-color: var(--card-bg);
            padding: 1rem 1.5rem;
            border-bottom: 1px solid var(--border-color);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }}
        header h1 {{ font-size: 1.3rem; font-weight: 700; color: #ffffff; }}
        header .meta {{ font-size: 0.9rem; color: var(--text-muted); }}
        
        .main-container {{
            display: flex;
            flex: 1;
            overflow: hidden;
        }}
        
        .viewer-pane {{
            flex: 1;
            position: relative;
            background-color: #0b0f19;
        }}
        #g3d_viewer {{
            width: 100%;
            height: 100%;
        }}
        
        .side-pane {{
            width: 380px;
            background-color: var(--card-bg);
            border-left: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            padding: 1.2rem;
            overflow-y: auto;
        }}
        
        .card {{
            background-color: #0f172a;
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 1rem;
            margin-bottom: 1rem;
        }}
        .card-title {{
            font-size: 0.9rem;
            font-weight: 600;
            color: var(--accent-blue);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 0.6rem;
        }}
        
        .contrast-select {{
            width: 100%;
            padding: 0.6rem;
            background-color: #1e293b;
            color: var(--text-main);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            font-size: 0.9rem;
            margin-bottom: 1rem;
        }}
        
        .legend {{
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-top: 0.5rem;
        }}
        .gradient-bar {{
            height: 12px;
            flex: 1;
            margin: 0 10px;
            border-radius: 6px;
            background: linear-gradient(to right, #3b82f6, #f8fafc, #ef4444);
        }}
        .legend-text {{ font-size: 0.75rem; color: var(--text-muted); }}

        .plddt-legend {{
            margin-top: 0.5rem;
            font-size: 0.75rem;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 4px;
        }}
        .plddt-item {{
            display: flex;
            align-items: center;
            color: var(--text-muted);
        }}
        .plddt-dot {{
            width: 10px;
            height: 10px;
            border-radius: 50%;
            margin-right: 6px;
            display: inline-block;
        }}
        
        .ptm-table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 0.85rem;
            margin-top: 0.5rem;
        }}
        .ptm-table th, .ptm-table td {{
            padding: 0.5rem;
            text-align: left;
            border-bottom: 1px solid var(--border-color);
        }}
        .ptm-table tr:hover {{
            background-color: #334155;
            cursor: pointer;
        }}
        .ptm-badge {{
            display: inline-block;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: 600;
            color: #000;
        }}
        
        .bottom-pane {{
            height: 180px;
            background-color: var(--card-bg);
            border-top: 1px solid var(--border-color);
            padding: 1rem 1.5rem;
            display: flex;
            flex-direction: column;
        }}
        .bottom-pane h3 {{
            font-size: 0.9rem;
            font-weight: 600;
            color: var(--text-muted);
            margin-bottom: 0.5rem;
        }}
        .nto-c-track {{
            flex: 1;
            position: relative;
            background-color: #0f172a;
            border: 1px solid var(--border-color);
            border-radius: 6px;
            display: flex;
            align-items: center;
            padding: 0 10px;
            overflow-x: auto;
        }}
        .backbone-line {{
            position: absolute;
            top: 50%;
            left: 20px;
            right: 20px;
            height: 4px;
            background-color: #334155;
            border-radius: 2px;
        }}
        .ptm-pin {{
            position: absolute;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            transform: translate(-50%, -50%);
            top: 50%;
            cursor: pointer;
            box-shadow: 0 0 6px rgba(0,0,0,0.5);
            transition: transform 0.2s, border-width 0.2s;
            border: 2px solid #ffffff;
        }}
        .ptm-pin:hover {{
            transform: translate(-50%, -50%) scale(1.5);
            z-index: 10;
        }}
    </style>
</head>
<body>
    <header>
        <div>
            <h1>3D PTM & log2-Fold-Change Visualizer</h1>
            <div class="meta">Protein: <strong>{gene_name}</strong> ({protein_acc}) | Length: {len(res_info_list)} AAs</div>
        </div>
        <div>
            <span style="font-size: 0.85rem; color: var(--text-muted);">AlphaFold DB + FGCZ prophosqua Integration</span>
        </div>
    </header>
    
    <div class="main-container">
        <div class="viewer-pane">
            <div id="g3d_viewer"></div>
        </div>
        
        <div class="side-pane">
            <div class="card">
                <div class="card-title">Backbone 3D Color Style</div>
                <select id="styleSelect" class="contrast-select" onchange="renderPTMs()" style="margin-bottom: 0.5rem;">
                    <option value="plddt" selected>AlphaFold Confidence (pLDDT)</option>
                    <option value="spectrum">N-to-C Rainbow Spectrum (Fallback)</option>
                    <option value="slate">Monochrome Slate Gray</option>
                </select>
                <div id="plddtLegend" class="plddt-legend">
                    <div class="plddt-item"><span class="plddt-dot" style="background:#1d4ed8;"></span> Very High (>90)</div>
                    <div class="plddt-item"><span class="plddt-dot" style="background:#38bdf8;"></span> Confident (70-90)</div>
                    <div class="plddt-item"><span class="plddt-dot" style="background:#facc15;"></span> Low (50-70)</div>
                    <div class="plddt-item"><span class="plddt-dot" style="background:#f97316;"></span> Very Low (<=50)</div>
                </div>
            </div>

            <div class="card">
                <div class="card-title">Condition Comparison</div>
                <select id="contrastSelect" class="contrast-select" onchange="filterContrast()">
                    {"".join([f'<option value="{c}">{c}</option>' for c in contrasts])}
                </select>
                <div class="legend">
                    <span class="legend-text">Down (-2.5 log2FC)</span>
                    <div class="gradient-bar"></div>
                    <span class="legend-text">Up (+2.5 log2FC)</span>
                </div>
            </div>
            
            <div class="card" id="infoCard">
                <div class="card-title">Residue Inspection</div>
                <p id="infoText" style="font-size: 0.85rem; color: var(--text-muted);">Click or hover over any PTM site on the 3D model or N-to-C track to inspect details.</p>
            </div>
            
            <div class="card" style="flex: 1; overflow-y: auto;">
                <div class="card-title">Identified PTM Sites</div>
                <table class="ptm-table">
                    <thead>
                        <tr>
                            <th>Site</th>
                            <th>log2FC</th>
                            <th>FDR</th>
                            <th>pLDDT</th>
                        </tr>
                    </thead>
                    <tbody id="ptmTableBody">
                    </tbody>
                </table>
            </div>
        </div>
    </div>
    
    <div class="bottom-pane">
        <h3>N-to-C Linear Sequence PTM Track</h3>
        <div class="nto-c-track" id="ntocTrack">
            <div class="backbone-line"></div>
        </div>
    </div>

    <script>
        const pdbData = {json.dumps(pdb_content)};
        const ptmData = {json.dumps(ptm_list)};
        const seqLen = {len(res_info_list)};
        
        let viewer = null;

        document.addEventListener('DOMContentLoaded', () => {{
            let element = document.getElementById('g3d_viewer');
            let config = {{ backgroundColor: '#0b0f19' }};
            viewer = $3Dmol.createViewer(element, config);
            
            viewer.addModel(pdbData, "pdb");
            
            renderPTMs();
            renderNtoCTrack();
            populateTable();
            
            viewer.zoomTo();
            viewer.render();
        }});

        function getCartoonStyle() {{
            const styleChoice = document.getElementById('styleSelect') ? document.getElementById('styleSelect').value : 'plddt';
            const legendDiv = document.getElementById('plddtLegend');
            if (legendDiv) {{
                legendDiv.style.display = (styleChoice === 'plddt') ? 'grid' : 'none';
            }}

            if (styleChoice === 'spectrum') {{
                return {{ cartoon: {{ color: 'spectrum', opacity: 0.75 }} }};
            }} else if (styleChoice === 'slate') {{
                return {{ cartoon: {{ color: '#475569', opacity: 0.75 }} }};
            }} else {{
                // AlphaFold DB pLDDT confidence colorfunc (Default)
                return {{
                    cartoon: {{
                        colorfunc: function(atom) {{
                            var p = atom.b;
                            if (p > 90) return '#1d4ed8'; // Very High - Dark Blue
                            if (p > 70) return '#38bdf8'; // Confident - Light Blue / Cyan
                            if (p > 50) return '#facc15'; // Low - Yellow
                            return '#f97316';             // Very Low / IDR - Orange
                        }},
                        opacity: 0.75
                    }}
                }};
            }}
        }}

        function renderPTMs() {{
            const currentContrast = document.getElementById('contrastSelect').value;
            const filtered = ptmData.filter(p => p.contrast === currentContrast);
            
            viewer.removeAllShapes();
            viewer.removeAllLabels();
            viewer.setStyle({{}}, getCartoonStyle());
            
            filtered.forEach(p => {{
                let sel = {{ resno: p.res_num }};
                
                // Add sphere at exact 3D coordinates if available
                if (p.x !== null && p.y !== null && p.z !== null) {{
                    viewer.addSphere({{
                        center: {{ x: p.x, y: p.y, z: p.z }},
                        radius: 3.2,
                        color: p.color,
                        alpha: 0.95
                    }});
                    
                    // Add text label next to residue
                    viewer.addLabel(`${{p.mod_aa}}${{p.res_num}}`, {{
                        position: {{ x: p.x, y: p.y, z: p.z }},
                        backgroundColor: 'rgba(15,23,42,0.85)',
                        fontColor: p.color,
                        fontSize: 11,
                        showBackground: true
                    }});
                }}
                
                // Also add sphere style to residue atoms
                viewer.addStyle(sel, {{ sphere: {{ color: p.color, scale: 0.8 }} }});
                
                // Add click listener to residue
                viewer.setClickable(sel, true, (atom, viewer, event) => {{
                    highlightResidue(p);
                }});
            }});
            viewer.render();
        }}

        function highlightResidue(p) {{
            let infoDiv = document.getElementById('infoCard');
            infoDiv.innerHTML = `
                <div class="card-title">Residue Inspection</div>
                <div style="font-size: 1.1rem; font-weight: 700; color: #ffffff; margin-bottom: 0.4rem;">
                    ${{p.mod_aa}}${{p.res_num}} (${{p.site_name}})
                </div>
                <div style="font-size: 0.85rem; margin-bottom: 0.3rem;">
                    <span class="ptm-badge" style="background-color: ${{p.color}}">log2FC: ${{p.log2fc > 0 ? '+' : ''}}${{p.log2fc.toFixed(2)}}</span>
                </div>
                <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">
                    FDR: <strong>${{p.fdr < 0.001 ? p.fdr.toExponential(2) : p.fdr.toFixed(3)}}</strong> | p-value: ${{p.p_value.toFixed(4)}}
                </div>
                <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">
                    AlphaFold pLDDT: <strong>${{p.plddt ? p.plddt.toFixed(1) : 'N/A'}}</strong> (Confidence)
                </div>
                <div style="font-size: 0.8rem; color: #cbd5e1; background: #1e293b; padding: 0.4rem; border-radius: 4px; font-family: monospace;">
                    Window: ${{p.seq_window || 'N/A'}}
                </div>
            `;
            
            viewer.zoomTo({{ resno: p.res_num }}, 1000);
        }}

        function filterContrast() {{
            renderPTMs();
            renderNtoCTrack();
            populateTable();
        }}

        function renderNtoCTrack() {{
            const track = document.getElementById('ntocTrack');
            track.querySelectorAll('.ptm-pin').forEach(el => el.remove());
            
            const currentContrast = document.getElementById('contrastSelect').value;
            const filtered = ptmData.filter(p => p.contrast === currentContrast);
            
            filtered.forEach(p => {{
                let pct = (p.res_num / seqLen) * 100;
                let pin = document.createElement('div');
                pin.className = 'ptm-pin';
                pin.style.left = `calc(${{pct}}% * 0.95 + 2.5%)`;
                pin.style.backgroundColor = p.color;
                pin.title = `${{p.mod_aa}}${{p.res_num}} (log2FC=${{p.log2fc.toFixed(2)}})`;
                
                pin.onclick = () => highlightResidue(p);
                track.appendChild(pin);
            }});
        }}

        function populateTable() {{
            const tbody = document.getElementById('ptmTableBody');
            tbody.innerHTML = '';
            
            const currentContrast = document.getElementById('contrastSelect').value;
            const filtered = ptmData.filter(p => p.contrast === currentContrast);
            
            filtered.sort((a, b) => a.fdr - b.fdr);
            
            filtered.forEach(p => {{
                let tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${{p.mod_aa}}${{p.res_num}}</strong></td>
                    <td><span class="ptm-badge" style="background-color: ${{p.color}}">${{p.log2fc > 0 ? '+' : ''}}${{p.log2fc.toFixed(2)}}</span></td>
                    <td>${{p.fdr < 0.001 ? p.fdr.toExponential(1) : p.fdr.toFixed(3)}}</td>
                    <td>${{p.plddt ? p.plddt.toFixed(0) : '-'}}</td>
                `;
                tr.onclick = () => highlightResidue(p);
                tbody.appendChild(tr);
            }});
        }}
    </script>
</body>
</html>
"""
    with open(output_html_path, 'w', encoding='utf-8') as f:
        f.write(html_content)
        
    return output_html_path
