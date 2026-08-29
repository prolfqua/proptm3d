// The table-centric viewer: a Lit shell around the shared 3Dmol renderer, with
// Tabulator tables as the single place where data is selected.
//
// All data selection happens in the two tables: the protein table picks the protein,
// and the site table's header filters (contrast dropdown, FDR <= threshold, ...) plus
// row selection decide which sites are drawn. The 3D area shows one panel per
// contrast present in the visible rows, so the same site in two contrasts appears in
// two side-by-side views.
//
// Light DOM, deliberately: `createRenderRoot` returns `this`. Tabulator appends its
// rules to `document.head` and those rules do not cross a shadow boundary, and the
// page's CSS is one plain stylesheet.
//
// Viewer panels are pooled per contrast: filtering with an unchanged contrast set
// reuses the existing 3Dmol viewer (and its loaded model) and only redraws the site
// marks; panels appear and disappear only when the contrast set changes.

import { foldChangeColor } from './color.js'
import { loadCatalog, loadPayload, loadText } from './payload.js'
import { LitElement, html, nothing } from './vendor/lit.js'
import { TabulatorFull } from './vendor/tabulator.js'
import { centerSite, renderPtmSites } from './viewer3d.js'

const PROTEIN_COLUMNS = [
  { title: 'Gene', field: 'gene_name', headerFilter: 'input' },
  { title: 'Accession', field: 'uniprot_acc', headerFilter: 'input' },
  { title: 'Sites', field: 'ptm_count', hozAlign: 'right', sorter: 'number', width: 66 },
  { title: 'Sig.', field: 'sig_count', hozAlign: 'right', sorter: 'number', width: 60 },
  {
    title: 'Max FC',
    field: 'max_log2fc',
    hozAlign: 'right',
    sorter: 'number',
    width: 86,
    headerTooltip: 'log2FC of the site with the largest absolute fold change',
    formatter: (cell) => {
      const value = cell.getValue()
      if (value === null || value === undefined) return '-'
      const color = foldChangeColor(value)
      return `<span style="background:${color};color:#000;padding:1px 6px;border-radius:4px;font-weight:600;">${value > 0 ? '+' : ''}${value.toFixed(2)}</span>`
    }
  }
]

const SITE_COLUMNS = [
  { title: 'Site', field: 'site', width: 90, headerFilter: 'input' },
  {
    title: 'Contrast',
    field: 'contrast',
    headerFilter: 'list',
    headerFilterParams: { valuesLookup: true, clearable: true },
    headerFilterFunc: '='
  },
  {
    title: 'log2FC',
    field: 'log2fc',
    hozAlign: 'right',
    sorter: 'number',
    headerFilter: 'number',
    headerFilterPlaceholder: '>= |x|',
    headerFilterFunc: (headerValue, rowValue) => Math.abs(rowValue) >= Number(headerValue),
    headerTooltip: 'log2 fold change; the filter keeps sites with |log2FC| at or above the value',
    formatter: (cell) => {
      const value = cell.getValue()
      const color = foldChangeColor(value)
      return `<span style="background:${color};color:#000;padding:1px 6px;border-radius:4px;font-weight:600;">${value > 0 ? '+' : ''}${value.toFixed(2)}</span>`
    }
  },
  {
    title: 'FDR',
    field: 'fdr',
    hozAlign: 'right',
    sorter: 'number',
    headerFilter: 'number',
    headerFilterPlaceholder: '<= ...',
    headerFilterFunc: '<=',
    formatter: (cell) => {
      const value = cell.getValue()
      return value < 0.001 ? value.toExponential(1) : value.toFixed(3)
    }
  },
  {
    title: 'pLDDT',
    field: 'plddt',
    hozAlign: 'right',
    sorter: 'number',
    headerTooltip:
      'AlphaFold per-residue model confidence (0-100, from the PDB B-factor column); below ~70 the region is likely flexible or intrinsically disordered',
    formatter: (cell) => (cell.getValue() === null ? '-' : cell.getValue().toFixed(0))
  },
  {
    title: 'Exposure',
    field: 'ppse',
    hozAlign: 'right',
    sorter: 'number',
    headerTooltip:
      'C-alpha neighbor count within 12 A of the site: low = surface-exposed, high = buried (simplified pPSE, after Bludau et al. 2022)',
    formatter: (cell) => (cell.getValue() === null ? '-' : cell.getValue().toFixed(0))
  },
  { title: 'Sequence window', field: 'seq_window', headerFilter: 'input' }
]

class PtmApp extends LitElement {
  static properties = {
    proteins: { type: Array },
    styleChoice: { type: String },
    meta: { type: String },
    pmlFile: { type: String },
    status: { type: String }
  }

  createRenderRoot () {
    return this
  }

  constructor () {
    super()
    this.proteins = []
    this.styleChoice = 'plddt'
    this.meta = 'Loading catalog...'
    this.pmlFile = ''
    this.status = ''
    this.table = null
    this.proteinTable = null
    this.ptms = []
    this.visiblePtms = []
    this.pdbText = ''
    this.viewerPanels = new Map() // contrast -> { panel, viewer }
    this.highlighted = null // { contrast, resNum }
  }

  async firstUpdated () {
    this.proteinTable = new TabulatorFull(this.querySelector('#proteinTable'), {
      data: [],
      index: 'uniprot_acc',
      columns: PROTEIN_COLUMNS,
      layout: 'fitColumns',
      height: '100%',
      selectableRows: 1,
      initialSort: [{ column: 'sig_count', dir: 'desc' }]
    })
    this.proteinTable.on('rowClick', (_event, row) => {
      this.loadProtein(this.proteins.findIndex((p) => p.uniprot_acc === row.getData().uniprot_acc))
    })

    this.table = new TabulatorFull(this.querySelector('#ptmTable'), {
      data: [],
      columns: SITE_COLUMNS,
      layout: 'fitColumns',
      height: '100%',
      selectableRows: 1,
      initialSort: [{ column: 'fdr', dir: 'asc' }]
    })
    this.table.on('dataFiltered', (_filters, rows) => {
      this.visiblePtms = rows.map((row) => row.getData())
      this.renderViewers()
    })
    // Selection only highlights; the header filters alone decide what is drawn.
    this.table.on('rowSelectionChanged', (data) => {
      if (data.length) {
        this.showSite(data[0])
      } else {
        this.highlighted = null
        this.status = ''
        this.renderViewers()
      }
    })

    try {
      const catalog = await loadCatalog()
      this.proteins = catalog.proteins
    } catch (error) {
      this.meta = 'Could not load the data/ catalog - serve this folder over HTTP (ptm3d serve).'
      throw error
    }
    await this.proteinTable.setData(this.proteins)
    if (this.proteins.length) {
      await this.loadProtein(0)
    } else {
      this.meta = 'Catalog is empty.'
    }
  }

  async loadProtein (index) {
    const entry = this.proteins[index]
    this.proteinTable.deselectRow()
    this.proteinTable.selectRow(entry.uniprot_acc)

    const data = await loadPayload(entry.data_file)
    this.pdbText = await loadText(data.pdb_file)

    this.ptms = data.ptms.map((p) => ({
      ...p,
      site: `${p.mod_aa}${p.res_num}`,
      color: foldChangeColor(p.log2fc)
    }))
    this.meta = `${data.gene_name} (${data.uniprot_acc}) | ${data.seq_len} AAs`
    this.pmlFile = entry.pml_file
    this.status = ''

    // A new protein invalidates every panel's loaded model.
    this.clearPanels()
    this.highlighted = null
    await this.table.setData(this.ptms)
    // Default to the first contrast; clear the dropdown to compare all contrasts.
    const contrasts = [...new Set(this.ptms.map((p) => p.contrast))].sort()
    if (contrasts.length) {
      this.table.setHeaderFilterValue('contrast', contrasts[0])
    }
  }

  clearPanels () {
    this.viewerPanels.forEach(({ panel }) => panel.remove())
    this.viewerPanels.clear()
  }

  ensurePanel (contrast) {
    let entry = this.viewerPanels.get(contrast)
    if (entry) return entry

    const panel = document.createElement('div')
    panel.className = 'viewer-panel'
    const label = document.createElement('div')
    label.className = 'panel-label'
    label.textContent = contrast
    const host = document.createElement('div')
    host.className = 'mol-host'
    panel.append(label, host)
    this.querySelector('#viewers').append(panel)

    const viewer = $3Dmol.createViewer(host, { backgroundColor: '#0b0f19' })
    viewer.addModel(this.pdbText, 'pdb')
    viewer.zoomTo()
    entry = { panel, viewer }
    this.viewerPanels.set(contrast, entry)
    return entry
  }

  /** Sites to draw: exactly the table's filtered rows; selection never changes this. */
  activePtms () {
    return this.visiblePtms
  }

  renderViewers () {
    if (!this.pdbText) return
    const groups = new Map()
    this.activePtms().forEach((p) => {
      if (!groups.has(p.contrast)) groups.set(p.contrast, [])
      groups.get(p.contrast).push(p)
    })

    for (const [contrast, { panel }] of [...this.viewerPanels]) {
      if (!groups.has(contrast)) {
        panel.remove()
        this.viewerPanels.delete(contrast)
      }
    }
    const sorted = [...groups.keys()].sort()
    sorted.forEach((contrast) => {
      const { viewer } = this.ensurePanel(contrast)
      const highlightResNum =
        this.highlighted && this.highlighted.contrast === contrast
          ? this.highlighted.resNum
          : null
      renderPtmSites(
        viewer, groups.get(contrast), this.styleChoice, (p) => this.selectRowFor(p), highlightResNum
      )
    })
    // Panel widths change with the panel count; 3Dmol must re-measure its canvases.
    requestAnimationFrame(() => {
      this.viewerPanels.forEach(({ viewer }) => {
        viewer.resize()
        viewer.render()
      })
    })
  }

  /** A click on a 3D sphere routes through the table's selection. */
  selectRowFor (p) {
    const row = this.table
      .getRows('active')
      .find((r) => r.getData().site === p.site && r.getData().contrast === p.contrast)
    if (row) {
      this.table.deselectRow()
      row.select()
    } else {
      this.showSite(p)
    }
  }

  showSite (p) {
    this.status = `${p.site} @ ${p.contrast} | log2FC ${p.log2fc > 0 ? '+' : ''}${p.log2fc.toFixed(2)} | FDR ${p.fdr < 0.001 ? p.fdr.toExponential(2) : p.fdr.toFixed(3)} | pLDDT ${p.plddt === null ? '-' : p.plddt.toFixed(1)}`
    this.highlighted = { contrast: p.contrast, resNum: p.res_num }
    this.renderViewers()
    const entry = this.viewerPanels.get(p.contrast)
    if (entry) centerSite(entry.viewer, p)
  }

  render () {
    return html`
      <div class="toolbar">
        <h1>3D PTM Visualizer</h1>
        <label>Backbone</label>
        <select
          .value=${this.styleChoice}
          @change=${(e) => {
            this.styleChoice = e.target.value
            this.renderViewers()
          }}
        >
          <option value="plddt">pLDDT confidence</option>
          <option value="spectrum">N-to-C spectrum</option>
          <option value="slate">Slate gray</option>
        </select>
        ${this.pmlFile ? html`<a href=${this.pmlFile} download>PyMOL script</a>` : nothing}
        <a href="index.html">Classic view</a>
        <span class="status">${this.status || this.meta}</span>
      </div>
      <div class="main-row">
        <div class="protein-pane"><div id="proteinTable"></div></div>
        <div class="right-col">
          <div class="viewer-host"><div id="viewers"></div></div>
          <div class="sites-pane"><div id="ptmTable"></div></div>
        </div>
      </div>
    `
  }
}

customElements.define('ptm-app', PtmApp)
