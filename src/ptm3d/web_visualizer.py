"""Standalone HTML export: a self-contained 3Dmol.js dashboard with embedded data.

This is the file-based alternative to the served browser app (:mod:`ptm3d.webapp`):
each generated page embeds the PDB text and PTM data and can be opened directly
from disk, with the 3Dmol.js script from CDN as its only external resource.
"""

from __future__ import annotations

import json
from pathlib import Path

import polars as pl

from ptm3d.protein_data import build_ptm_records

_LOG2FC_COLOR_SCALE = 2.5
_LOG2FC_COLOR_DAMPING = 0.8


def _fold_change_hex(log2fc: float) -> str:
    """Map a log2FC value onto a green-white-red gradient as a hex color."""
    intensity = min(1.0, abs(log2fc) / _LOG2FC_COLOR_SCALE)
    faded = int(255 * (1 - intensity * _LOG2FC_COLOR_DAMPING))
    if log2fc > 0:
        r_val, g_val, b_val = 255, faded, faded
    else:
        r_val, g_val, b_val = faded, 255, faded
    return f"#{r_val:02x}{g_val:02x}{b_val:02x}"


def generate_interactive_html(
    pdb_path: Path | str,
    ptm_df: pl.DataFrame,
    res_df: pl.DataFrame,
    output_html_path: Path | str,
    protein_acc: str = "UNKNOWN",
    gene_name: str = "UNKNOWN",
) -> Path:
    """Write a standalone interactive HTML dashboard for one protein.

    The page embeds the PDB text and PTM data; its only external resource is the
    3Dmol.js script loaded from ``https://3dmol.org``.

    Args:
        pdb_path: Path to the structure file to embed.
        ptm_df: Standardized PTM table for this protein.
        res_df: Residue table from :mod:`ptm3d.structural_context`.
        output_html_path: Destination for the HTML file.
        protein_acc: UniProt accession shown in the header.
        gene_name: Gene symbol shown in the header.

    Returns:
        The path of the written HTML file.
    """
    output_path = Path(output_html_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    pdb_content = Path(pdb_path).read_text(encoding="utf-8", errors="ignore")
    ptm_list = [
        {**record, "color": _fold_change_hex(record["log2fc"])}
        for record in build_ptm_records(ptm_df, res_df, protein_acc)
    ]
    seq_len = res_df.height
    contrasts = sorted({p["contrast"] for p in ptm_list}) if ptm_list else ["Default"]
    contrast_options = "".join(f'<option value="{c}">{c}</option>' for c in contrasts)

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
            background: linear-gradient(to right, #22c55e, #f8fafc, #ef4444);
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
            <div class="meta">Protein: <strong>{gene_name}</strong> ({protein_acc}) | Length: {seq_len} AAs</div>
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
                    {contrast_options}
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
        const seqLen = {seq_len};

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
    output_path.write_text(html_content, encoding="utf-8")
    return output_path
