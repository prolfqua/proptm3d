// The table-centric viewer: a Lit shell around the shared 3Dmol renderer, with
// Tabulator tables as the single place where data is selected.
//
// Selection model:
// - The toolbar's contrast dropdown scopes everything: the category table, the
//   protein table's Sig./Max FC columns, the site table, and the 3D panels
//   ("All contrasts" shows one panel per contrast side by side).
// - The category table (present when the run has enrichment results) filters:
//   selecting a kinase/signature keeps only proteins and sites that are members,
//   under the chosen member mode (leading edge or full mapped set). The figure
//   keeps drawing ALL sites of the protein and only marks the members; the rest
//   turns into grey, unlabeled context.
// - Sphere color is a switchable channel: log2FC (green-white-red) or category
//   (accent vs grey). Selecting a category switches to category, deselecting
//   switches back; the toolbar select overrides at any time.
// - Row selection in the site table only highlights and centers, never changing
//   which sites are drawn.
//
// Light DOM, deliberately: `createRenderRoot` returns `this`. Tabulator appends
// its rules to `document.head` and those rules do not cross a shadow boundary.
//
// Viewer panels are pooled per contrast: filtering with an unchanged contrast set
// reuses the existing 3Dmol viewer (and its loaded model) and only redraws marks.
//
// Under the 3D panels, the N-to-C pane draws the same decorated sites as a
// lollipop figure, one row per drawn contrast; clicking a head routes through the
// site table's selection exactly like clicking a sphere does.

import { foldChangeColor } from './color.js'
import { ntocFigure } from './panels/ntoc.js'
import { loadCatalog, loadCategories, loadPayload, loadText } from './payload.js'
import { clearFigure, renderFigure, resizeFigure } from './render/plotly.js'
import { LitElement, html, nothing } from './vendor/lit.js'
import { TabulatorFull } from './vendor/tabulator.js'
import { centerSite, renderPtmSites } from './viewer3d.js'

const CATEGORY_COLOR = '#d946ef' // Member sites in category color mode.
const CONTEXT_COLOR = '#94a3b8' //  Non-member context sites while a category is selected.

const fcBadge = (value) => {
  if (value === null || value === undefined) return '-'
  const color = foldChangeColor(value)
  return `<span style="background:${color};color:#000;padding:1px 5px;border-radius:4px;font-weight:600;">${value > 0 ? '+' : ''}${value.toFixed(2)}</span>`
}

const fdrText = (value) => (value < 0.001 ? value.toExponential(1) : value.toFixed(3))

const canonicalWindow = (value) => String(value || '').toUpperCase()

const PROTEIN_COLUMNS = [
  { title: 'Gene', field: 'gene_name', headerFilter: 'input' },
  { title: 'Accession', field: 'uniprot_acc', headerFilter: 'input' },
  { title: 'Sites', field: 'ptm_count', hozAlign: 'right', sorter: 'number', width: 58 },
  {
    title: 'Sig.',
    field: 'sig_count',
    hozAlign: 'right',
    sorter: 'number',
    width: 52,
    headerTooltip: 'Significant sites in the selected contrast (all contrasts when none is selected)'
  },
  {
    title: 'Max FC',
    field: 'max_log2fc',
    hozAlign: 'right',
    sorter: 'number',
    width: 78,
    headerTooltip: 'log2FC of the site with the largest absolute fold change in the selected contrast',
    formatter: (cell) => fcBadge(cell.getValue())
  }
]

const CATEGORY_COLUMNS = [
  { title: 'Term', field: 'term_id', headerFilter: 'input', minWidth: 110 },
  {
    title: 'Source',
    field: 'source',
    width: 86,
    headerFilter: 'list',
    headerFilterParams: { valuesLookup: true, clearable: true }
  },
  {
    title: 'NES',
    field: 'nes',
    hozAlign: 'right',
    sorter: 'number',
    width: 64,
    formatter: (cell) => {
      const value = cell.getValue()
      if (value === null || value === undefined) return '-'
      const color = value > 0 ? '#f87171' : '#4ade80'
      return `<span style="color:${color};font-weight:600;">${value > 0 ? '+' : ''}${value.toFixed(2)}</span>`
    }
  },
  {
    title: 'FDR',
    field: 'fdr',
    hozAlign: 'right',
    sorter: 'number',
    width: 70,
    headerFilter: 'number',
    headerFilterPlaceholder: '<= ...',
    headerFilterFunc: '<=',
    formatter: (cell) => fdrText(cell.getValue())
  },
  {
    title: 'Sites',
    field: 'sites_catalog',
    hozAlign: 'right',
    sorter: 'number',
    width: 74,
    headerTooltip:
      'Member sites in the processed proteins / member sites in the whole dataset, for the chosen member mode',
    formatter: (cell) => `${cell.getValue()}/${cell.getData().sites_total}`
  }
]

class PtmApp extends LitElement {
  static properties = {
    proteins: { type: Array },
    styleChoice: { type: String },
    meta: { type: String },
    pmlFile: { type: String },
    status: { type: String },
    contrast: { type: String },
    contrasts: { type: Array },
    memberMode: { type: String },
    colorBy: { type: String },
    hasCategories: { type: Boolean },
    leftWidth: { type: Number },
    ntocHeight: { type: Number }
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
    this.contrast = ''
    this.contrasts = []
    this.memberMode = 'leading'
    this.colorBy = 'log2fc'
    this.hasCategories = false
    this.leftWidth = 520
    this.ntocHeight = 250
    this.fdrThreshold = 0.05
    this.protein = null // The loaded protein payload.
    this.ntocRecords = [] // Records the N-to-C heads' customdata index into.
    this.categoriesPayload = null
    this.table = null
    this.proteinTable = null
    this.categoriesTable = null
    this.selectedTermKey = null
    this.termWindows = null // Set of canonical windows of the selected term, or null.
    this.termProteins = null // Set of catalog accessions of the selected term, or null.
    this.windowTerms = new Map() // canonical window -> [term_id] for the current scope.
    this.ptms = []
    this.visiblePtms = []
    this.pdbText = ''
    this.viewerPanels = new Map() // contrast -> { panel, viewer }
    this.highlighted = null // { contrast, resNum }
  }

  siteColumns () {
    return [
      { title: 'Site', field: 'site', width: 64, headerFilter: 'input' },
      { title: 'Contrast', field: 'contrast', width: 110 },
      {
        title: 'log2FC',
        field: 'log2fc',
        hozAlign: 'right',
        sorter: 'number',
        width: 76,
        headerFilter: 'number',
        headerFilterPlaceholder: '>= |x|',
        headerFilterFunc: (headerValue, rowValue) => Math.abs(rowValue) >= Number(headerValue),
        headerTooltip: 'log2 fold change; the filter keeps sites with |log2FC| at or above the value',
        formatter: (cell) => fcBadge(cell.getValue())
      },
      {
        title: 'FDR',
        field: 'fdr',
        hozAlign: 'right',
        sorter: 'number',
        width: 70,
        headerFilter: 'number',
        headerFilterPlaceholder: '<= ...',
        headerFilterFunc: '<=',
        formatter: (cell) => fdrText(cell.getValue())
      },
      {
        title: 'pLDDT',
        field: 'plddt',
        hozAlign: 'right',
        sorter: 'number',
        width: 62,
        headerTooltip:
          'AlphaFold per-residue model confidence (0-100, from the PDB B-factor column); below ~70 the region is likely flexible or intrinsically disordered',
        formatter: (cell) => (cell.getValue() === null ? '-' : cell.getValue().toFixed(0))
      },
      {
        title: 'Exp.',
        field: 'ppse',
        hozAlign: 'right',
        sorter: 'number',
        width: 54,
        headerTooltip:
          'Exposure: C-alpha neighbor count within 12 A of the site; low = surface-exposed, high = buried (simplified pPSE, after Bludau et al. 2022)',
        formatter: (cell) => (cell.getValue() === null ? '-' : cell.getValue().toFixed(0))
      },
      {
        title: 'Cat.',
        field: 'seq_window',
        width: 50,
        headerSort: false,
        headerTooltip: 'Number of categories this site belongs to in the current contrast and member mode',
        formatter: (cell) => {
          const terms = this.windowTerms.get(canonicalWindow(cell.getValue())) || []
          return terms.length ? String(terms.length) : ''
        },
        tooltip: (_event, cell) =>
          (this.windowTerms.get(canonicalWindow(cell.getValue())) || []).join('\n')
      },
      { title: 'Sequence window', field: 'seq_window', minWidth: 90, headerFilter: 'input' }
    ]
  }

  async firstUpdated () {
    this.categoriesTable = new TabulatorFull(this.querySelector('#categoriesTable'), {
      data: [],
      index: 'key',
      columns: CATEGORY_COLUMNS,
      layout: 'fitColumns',
      height: '100%',
      selectableRows: 1,
      initialSort: [{ column: 'fdr', dir: 'asc' }]
    })
    this.categoriesTable.on('rowSelectionChanged', (data) => {
      if (data.length) {
        this.selectTerm(data[0])
      } else {
        this.clearTerm()
      }
    })

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
    this.proteinTable.setFilter((data) => !this.termProteins || this.termProteins.has(data.uniprot_acc))

    this.table = new TabulatorFull(this.querySelector('#ptmTable'), {
      data: [],
      columns: this.siteColumns(),
      layout: 'fitColumns',
      height: '100%',
      selectableRows: 1,
      initialSort: [{ column: 'fdr', dir: 'asc' }]
    })
    this.table.on('dataFiltered', (_filters, rows) => {
      this.visiblePtms = rows.map((row) => row.getData())
      this.renderViewers()
    })
    // Selection only highlights; the filters alone decide what is drawn/counted.
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
      const [catalog, categories] = await Promise.all([loadCatalog(), loadCategories()])
      this.proteins = catalog.proteins
      this.fdrThreshold = catalog.fdr_threshold ?? 0.05
      this.categoriesPayload = categories
      this.hasCategories = categories !== null && Object.keys(categories.contrasts).length > 0
    } catch (error) {
      this.meta = 'Could not load the data/ catalog - serve this folder over HTTP (proptm3d serve).'
      throw error
    }

    const fromStats = this.proteins.flatMap((p) => Object.keys(p.contrast_stats || {}))
    const fromCategories = this.hasCategories ? Object.keys(this.categoriesPayload.contrasts) : []
    this.contrasts = [...new Set([...fromStats, ...fromCategories])].sort()
    this.contrast = this.contrasts[0] || ''

    this.refreshCategories()
    await this.proteinTable.setData(this.proteinRows())
    if (this.proteins.length) {
      await this.loadProtein(0)
    } else {
      this.meta = 'Catalog is empty.'
    }
  }

  /** Protein rows with Sig./Max FC scoped to the selected contrast. */
  proteinRows () {
    if (!this.contrast) return this.proteins
    return this.proteins.map((p) => {
      const stat = (p.contrast_stats || {})[this.contrast]
      return {
        ...p,
        sig_count: stat ? stat.sig_count : 0,
        max_log2fc: stat ? stat.max_log2fc : null
      }
    })
  }

  /** Category rows of the selected contrast, with counts for the member mode. */
  categoryRows () {
    if (!this.hasCategories || !this.contrast) return []
    const block = this.categoriesPayload.contrasts[this.contrast]
    if (!block) return []
    const mode = this.memberMode === 'leading' ? 'leading' : 'members'
    return block.terms.map((t) => ({
      ...t,
      key: `${t.source}:${t.term_id}`,
      sites_catalog: t[`${mode}_sites_catalog`],
      sites_total: t[`${mode}_sites_total`]
    }))
  }

  /** Rebuild the category table and the window -> terms index for the scope. */
  refreshCategories () {
    this.windowTerms = new Map()
    const block = this.hasCategories && this.contrast
      ? this.categoriesPayload.contrasts[this.contrast]
      : null
    if (block) {
      const mode = this.memberMode === 'leading' ? 'leading' : 'members'
      block.terms.forEach((t) => {
        t[mode].forEach((i) => {
          const window = block.windows[i]
          if (!this.windowTerms.has(window)) this.windowTerms.set(window, [])
          this.windowTerms.get(window).push(t.term_id)
        })
      })
    }
    if (this.categoriesTable) {
      const keep = this.selectedTermKey
      this.categoriesTable.setData(this.categoryRows()).then(() => {
        if (keep && this.categoriesTable.getRow(keep)) {
          this.categoriesTable.selectRow(keep)
        }
      })
    }
  }

  setContrast (contrast) {
    this.contrast = contrast
    this.selectedTermKey = null
    this.termWindows = null
    this.termProteins = null
    this.colorBy = 'log2fc'
    this.refreshCategories()
    const selected = this.proteinTable.getSelectedData()[0]
    this.proteinTable.setData(this.proteinRows()).then(() => {
      if (selected) this.proteinTable.selectRow(selected.uniprot_acc)
      this.proteinTable.refreshFilter()
    })
    this.applySiteFilter()
  }

  setMemberMode (mode) {
    this.memberMode = mode
    this.refreshCategories()
    if (this.selectedTermKey) {
      const row = this.categoriesTable.getRow(this.selectedTermKey)
      if (row) this.updateTermSets(row.getData())
      this.proteinTable.refreshFilter()
      this.applySiteFilter()
    } else {
      this.table.redraw() // The Cat. column values follow the member mode.
    }
  }

  updateTermSets (term) {
    const block = this.categoriesPayload.contrasts[this.contrast]
    const mode = this.memberMode === 'leading' ? 'leading' : 'members'
    this.termWindows = new Set(term[mode].map((i) => block.windows[i]))
    this.termProteins = new Set(term[`${mode}_proteins`].map((i) => block.proteins[i]))
  }

  selectTerm (term) {
    this.selectedTermKey = term.key
    this.updateTermSets(term)
    this.colorBy = 'category'
    this.status = `${term.term_id} (${term.source}) | NES ${term.nes > 0 ? '+' : ''}${term.nes.toFixed(2)} | FDR ${fdrText(term.fdr)} | ${term.sites_catalog}/${term.sites_total} member sites in catalog`
    this.proteinTable.refreshFilter()
    this.applySiteFilter()
  }

  clearTerm () {
    this.selectedTermKey = null
    this.termWindows = null
    this.termProteins = null
    this.colorBy = 'log2fc'
    this.status = ''
    this.proteinTable.refreshFilter()
    this.applySiteFilter()
  }

  /** The programmatic site filter: contrast scope plus category membership. */
  applySiteFilter () {
    this.table.setFilter((data) => {
      if (this.contrast && data.contrast !== this.contrast) return false
      return !this.termWindows || this.termWindows.has(canonicalWindow(data.seq_window))
    })
  }

  async loadProtein (index) {
    const entry = this.proteins[index]
    this.proteinTable.deselectRow()
    this.proteinTable.selectRow(entry.uniprot_acc)

    const data = await loadPayload(entry.data_file)
    this.pdbText = await loadText(data.pdb_file)
    this.protein = data

    this.ptms = data.ptms.map((p) => ({
      ...p,
      site: `${p.mod_aa}${p.res_num}`
    }))
    this.meta = `${data.gene_name} (${data.uniprot_acc}) | ${data.protein_length || data.seq_len} AAs`
    this.pmlFile = entry.pml_file
    this.status = ''

    // A new protein invalidates every panel's loaded model.
    this.clearPanels()
    this.highlighted = null
    await this.table.setData(this.ptms)
    this.applySiteFilter()
  }

  clearPanels () {
    this.viewerPanels.forEach(({ panel }) => panel.remove())
    this.viewerPanels.clear()
    clearFigure(this.querySelector('#ntoc'))
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

  /**
   * Sites to draw. Without a selected category: exactly the table's filtered
   * rows. With one: every site of the contrast scope stays visible (context)
   * and the members are marked - the category filters the tables, not the figure.
   */
  activePtms () {
    if (!this.termWindows) return this.visiblePtms
    return this.ptms.filter((p) => !this.contrast || p.contrast === this.contrast)
  }

  /** Color and emphasis of one drawn site under the current mode. */
  decorate (p) {
    if (!this.termWindows) {
      return { ...p, color: foldChangeColor(p.log2fc), dim: false }
    }
    if (!this.termWindows.has(canonicalWindow(p.seq_window))) {
      return { ...p, color: CONTEXT_COLOR, dim: true }
    }
    const color = this.colorBy === 'category' ? CATEGORY_COLOR : foldChangeColor(p.log2fc)
    return { ...p, color, dim: false }
  }

  renderViewers () {
    if (!this.pdbText) return
    const groups = new Map()
    this.activePtms().forEach((p) => {
      if (!groups.has(p.contrast)) groups.set(p.contrast, [])
      groups.get(p.contrast).push(this.decorate(p))
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
      let list = groups.get(contrast)
      // Labels drown a crowded view (and its frame rate): above 50 drawn sites,
      // keep them only on category members and the highlighted site.
      if (list.length > 50 && !this.termWindows) {
        list = list.map((p) => ({ ...p, nolabel: true }))
      }
      renderPtmSites(viewer, list, this.styleChoice, (p) => this.selectRowFor(p), highlightResNum)
    })
    this.renderNtoc(sorted.map((contrast) => ({ contrast, ptms: groups.get(contrast) })))
    // Panel widths change with the panel count; 3Dmol must re-measure its canvases.
    requestAnimationFrame(() => {
      this.viewerPanels.forEach(({ viewer }) => {
        viewer.resize()
        viewer.render()
      })
    })
  }

  /** Draw the lollipop rows for the contrasts the 3D panels show. */
  renderNtoc (rows) {
    const host = this.querySelector('#ntoc')
    if (!rows.length) {
      clearFigure(host)
      return
    }
    this.ntocHeight = Math.min(150 * rows.length + 100, Math.round(window.innerHeight * 0.45))
    const figure = ntocFigure({
      rows,
      proteinLength: this.protein.protein_length || this.protein.seq_len,
      proteinLog2fc: this.protein.protein_log2fc || {},
      fdrThreshold: this.fdrThreshold,
      highlighted: this.highlighted
    })
    this.ntocRecords = figure.records
    renderFigure(host, figure, {
      height: this.ntocHeight - 24,
      onClick: (index) => this.selectRowFor(this.ntocRecords[index])
    })
  }

  /** A click on a 3D sphere routes through the table's selection when it can. */
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

  /** Drag the splitter to resize the left column; tables and viewers re-measure on release. */
  startResize (event) {
    event.preventDefault()
    const splitter = event.currentTarget
    splitter.classList.add('dragging')
    const startX = event.clientX
    const startWidth = this.leftWidth
    const move = (e) => {
      this.leftWidth = Math.min(Math.max(startWidth + e.clientX - startX, 280), window.innerWidth - 360)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      splitter.classList.remove('dragging')
      ;[this.categoriesTable, this.proteinTable, this.table].forEach((t) => t && t.redraw(true))
      this.viewerPanels.forEach(({ viewer }) => {
        viewer.resize()
        viewer.render()
      })
      resizeFigure(this.querySelector('#ntoc'))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
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
        <label>Contrast</label>
        <select .value=${this.contrast} @change=${(e) => this.setContrast(e.target.value)}>
          <option value="">All contrasts</option>
          ${this.contrasts.map((c) => html`<option value=${c} ?selected=${c === this.contrast}>${c}</option>`)}
        </select>
        ${this.hasCategories
          ? html`
              <label>Members</label>
              <select .value=${this.memberMode} @change=${(e) => this.setMemberMode(e.target.value)}>
                <option value="leading">Leading edge</option>
                <option value="members">Full set</option>
              </select>
            `
          : nothing}
        <label>Color</label>
        <select
          .value=${this.colorBy}
          @change=${(e) => {
            this.colorBy = e.target.value
            this.renderViewers()
          }}
        >
          <option value="log2fc" ?selected=${this.colorBy === 'log2fc'}>log2FC</option>
          <option value="category" ?selected=${this.colorBy === 'category'}>Category</option>
        </select>
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
        <div class="left-col" style="width:${this.leftWidth}px">
          <div class="categories-pane ${this.hasCategories ? '' : 'hidden'}">
            <div class="pane-title">Categories</div>
            <div class="pane-body"><div id="categoriesTable"></div></div>
          </div>
          <div class="protein-pane">
            <div class="pane-title">Proteins</div>
            <div class="pane-body"><div id="proteinTable"></div></div>
          </div>
          <div class="sites-pane">
            <div class="pane-title">PTM sites</div>
            <div class="pane-body"><div id="ptmTable"></div></div>
          </div>
        </div>
        <div class="splitter" @pointerdown=${this.startResize}></div>
        <div class="right-col">
          <div class="viewer-host"><div id="viewers"></div></div>
          <div class="ntoc-pane" style="height:${this.ntocHeight}px">
            <div class="pane-title">N-to-C</div>
            <div id="ntoc" class="pane-body"></div>
          </div>
        </div>
      </div>
    `
  }
}

customElements.define('ptm-app', PtmApp)
