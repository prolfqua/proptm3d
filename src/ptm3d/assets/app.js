// ptm3d browser app: loads the run catalog plus per-protein data + PDB files
// written by the ptm3d pipeline (JSON or CBOR) and renders them with 3Dmol.js.

import { foldChangeColor } from './color.js';
import { loadCatalog, loadPayload, loadText } from './payload.js';
import { centerSite, renderPtmSites } from './viewer3d.js';

const state = {
    viewer: null,
    catalog: { proteins: [] },
    ptms: [],
    seqLen: 0,
    highlightedResNum: null,
};

async function init() {
    const element = document.getElementById('g3d_viewer');
    state.viewer = $3Dmol.createViewer(element, { backgroundColor: '#0b0f19' });

    try {
        state.catalog = await loadCatalog();
    } catch (error) {
        document.getElementById('proteinMeta').textContent =
            'Could not load the data/ catalog - serve this folder over HTTP (ptm3d serve).';
        throw error;
    }

    const select = document.getElementById('proteinSelect');
    state.catalog.proteins.forEach((p, i) => {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `${p.gene_name} (${p.uniprot_acc}) - ${p.sig_count} significant sites`;
        select.appendChild(option);
    });
    select.onchange = () => loadProtein(Number(select.value));
    document.getElementById('styleSelect').onchange = renderPTMs;
    document.getElementById('contrastSelect').onchange = renderContrast;

    if (state.catalog.proteins.length) {
        await loadProtein(0);
    } else {
        document.getElementById('proteinMeta').textContent = 'Catalog is empty.';
    }
}

async function loadProtein(index) {
    const entry = state.catalog.proteins[index];
    const data = await loadPayload(entry.data_file);
    const pdbText = await loadText(data.pdb_file);

    state.ptms = data.ptms.map((p) => ({ ...p, color: foldChangeColor(p.log2fc) }));
    state.seqLen = data.seq_len;
    state.highlightedResNum = null;

    document.getElementById('proteinMeta').innerHTML =
        `Protein: <strong>${data.gene_name}</strong> (${data.uniprot_acc}) | Length: ${data.seq_len} AAs`;
    const pmlLink = document.getElementById('pmlLink');
    pmlLink.href = entry.pml_file;

    const contrasts = [...new Set(state.ptms.map((p) => p.contrast))].sort();
    const contrastSelect = document.getElementById('contrastSelect');
    contrastSelect.innerHTML = '';
    (contrasts.length ? contrasts : ['Default']).forEach((c) => {
        const option = document.createElement('option');
        option.value = c;
        option.textContent = c;
        contrastSelect.appendChild(option);
    });

    state.viewer.removeAllModels();
    state.viewer.addModel(pdbText, 'pdb');
    renderContrast();
    state.viewer.zoomTo();
    state.viewer.render();
}

function currentPtms() {
    const contrast = document.getElementById('contrastSelect').value;
    return state.ptms.filter((p) => p.contrast === contrast);
}

function renderPTMs() {
    const styleChoice = document.getElementById('styleSelect').value;
    const legendDiv = document.getElementById('plddtLegend');
    legendDiv.style.display = styleChoice === 'plddt' ? 'grid' : 'none';
    renderPtmSites(
        state.viewer, currentPtms(), styleChoice, highlightResidue, state.highlightedResNum
    );
}

function highlightResidue(p) {
    const infoDiv = document.getElementById('infoCard');
    infoDiv.innerHTML = `
        <div class="card-title">Residue Inspection</div>
        <div style="font-size: 1.1rem; font-weight: 700; color: #ffffff; margin-bottom: 0.4rem;">
            ${p.mod_aa}${p.res_num} (${p.site_name})
        </div>
        <div style="font-size: 0.85rem; margin-bottom: 0.3rem;">
            <span class="ptm-badge" style="background-color: ${p.color}">log2FC: ${p.log2fc > 0 ? '+' : ''}${p.log2fc.toFixed(2)}</span>
        </div>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">
            FDR: <strong>${p.fdr < 0.001 ? p.fdr.toExponential(2) : p.fdr.toFixed(3)}</strong> | p-value: ${p.p_value.toFixed(4)}
        </div>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">
            AlphaFold pLDDT: <strong>${p.plddt ? p.plddt.toFixed(1) : 'N/A'}</strong> (Confidence)
        </div>
        <div style="font-size: 0.8rem; color: #cbd5e1; background: #1e293b; padding: 0.4rem; border-radius: 4px; font-family: monospace;">
            Window: ${p.seq_window || 'N/A'}
        </div>
    `;
    state.highlightedResNum = p.res_num;
    renderPTMs();
    centerSite(state.viewer, p);
}

function renderContrast() {
    renderPTMs();
    renderNtoCTrack();
    populateTable();
}

function renderNtoCTrack() {
    const track = document.getElementById('ntocTrack');
    track.querySelectorAll('.ptm-pin').forEach((el) => el.remove());

    currentPtms().forEach((p) => {
        const pct = (p.res_num / state.seqLen) * 100;
        const pin = document.createElement('div');
        pin.className = 'ptm-pin';
        pin.style.left = `calc(${pct}% * 0.95 + 2.5%)`;
        pin.style.backgroundColor = p.color;
        pin.title = `${p.mod_aa}${p.res_num} (log2FC=${p.log2fc.toFixed(2)})`;
        pin.onclick = () => highlightResidue(p);
        track.appendChild(pin);
    });
}

function populateTable() {
    const tbody = document.getElementById('ptmTableBody');
    tbody.innerHTML = '';

    const filtered = [...currentPtms()].sort((a, b) => a.fdr - b.fdr);
    filtered.forEach((p) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${p.mod_aa}${p.res_num}</strong></td>
            <td><span class="ptm-badge" style="background-color: ${p.color}">${p.log2fc > 0 ? '+' : ''}${p.log2fc.toFixed(2)}</span></td>
            <td>${p.fdr < 0.001 ? p.fdr.toExponential(1) : p.fdr.toFixed(3)}</td>
            <td>${p.plddt ? p.plddt.toFixed(0) : '-'}</td>
        `;
        tr.onclick = () => highlightResidue(p);
        tbody.appendChild(tr);
    });
}

document.addEventListener('DOMContentLoaded', init);
