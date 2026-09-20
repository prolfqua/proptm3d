// The composition root: loads the catalog, owns the session, builds the tables,
// the 3D panel pool and the N-to-C figure into the shell's hosts, and applies
// the shell's intents.
//
// Selection model:
// - The contrast select scopes everything: the category table, the protein
//   table's Sig./Max FC columns, the site table, the 3D panels (one per contrast
//   under "All contrasts") and the N-to-C rows.
// - Selecting a category keeps only member proteins and sites in the tables; the
//   figures keep every site of the scope and mark the members.
// - Selecting a site row, a sphere or a lollipop head highlights and centers that
//   site, never changing which sites are drawn.

import { loadCatalog, loadCategories, loadPayload, loadText } from './lib/payload.js'
import { Session } from './lib/session.js'
import { ntocFigure } from './panels/ntoc.js'
import { clearFigure, renderFigure, resizeFigure } from './render/plotly.js'
import { categoriesTable, proteinTable, siteTable, tableReady } from './render/tables.js'
import { ViewerPool } from './render/viewer3d.js'
import './shell/ptm-app.js'

class App {
  constructor (shell, session) {
    this.shell = shell
    this.session = session
    this.visibleSites = []
    this.ntocRecords = []
    this.currentProtein = null
  }

  async start () {
    const { shell, session } = this
    shell.contrasts = session.contrasts
    shell.contrast = session.contrast
    shell.hasCategories = session.hasCategories
    shell.total = session.proteins.length
    shell.meta = `${session.proteins.length} proteins in the catalog`
    await shell.updateComplete

    this.categories = categoriesTable(shell.querySelector('#categoriesTable'))
    this.proteins = proteinTable(shell.querySelector('#proteinTable'))
    this.sites = siteTable(shell.querySelector('#ptmTable'), () => this.windowTerms)
    this.viewers = new ViewerPool(shell.querySelector('#viewers'))
    this.ntocHost = shell.querySelector('#ntoc')
    await Promise.all([this.categories, this.proteins, this.sites].map(tableReady))

    this.categories.on('rowSelectionChanged', (data) => (data.length ? this.selectTerm(data[0]) : this.clearTerm()))
    this.proteins.on('rowClick', (_event, row) => this.openProtein(row.getData().uniprot_acc))
    this.proteins.on('dataFiltered', (_filters, rows) => { shell.matched = rows.length })
    this.proteins.setFilter((row) => session.proteinVisible(row))
    this.sites.on('dataFiltered', (_filters, rows) => {
      this.visibleSites = rows.map((row) => row.getData())
      this.draw()
    })
    this.sites.on('rowSelectionChanged', (data) => (data.length ? this.showSite(data[0]) : this.clearSite()))
    shell.addEventListener('intent', (event) => this.apply(event.detail))

    this.refreshCategories()
    await this.proteins.setData(session.proteinRows())
    if (!session.proteins.length) shell.meta = 'Catalog is empty.'
  }

  apply ({ type, value }) {
    const { shell, session } = this
    if (type === 'workspace') {
      shell.workspace = value
      shell.updateComplete.then(() => this.relayout())
    } else if (type === 'contrast') {
      session.setContrast(value)
      shell.contrast = value
      shell.colorBy = session.colorBy
      shell.status = ''
      this.refreshCategories()
      const selected = this.proteins.getSelectedData()[0]
      this.proteins.setData(session.proteinRows()).then(() => {
        if (selected) this.proteins.selectRow(selected.uniprot_acc)
        this.proteins.refreshFilter()
      })
      this.applySiteFilter()
    } else if (type === 'member-mode') {
      session.setMemberMode(value)
      shell.memberMode = value
      this.refreshCategories()
      if (session.term) {
        this.proteins.refreshFilter()
        this.applySiteFilter()
      } else {
        this.sites.redraw() // The Cat. column values follow the member mode.
      }
    } else if (type === 'color-by') {
      session.colorBy = value
      shell.colorBy = value
      this.draw()
    } else if (type === 'style') {
      session.styleChoice = value
      shell.styleChoice = value
      this.draw()
    } else if (type === 'layout') {
      this.relayout()
    }
  }

  /** Tables and figures re-measure after a workspace switch or a splitter drag. */
  relayout () {
    ;[this.categories, this.proteins, this.sites].forEach((table) => table.redraw(true))
    this.viewers.resize()
    resizeFigure(this.ntocHost)
  }

  refreshCategories () {
    this.windowTerms = this.session.windowTerms()
    const keep = this.session.term ? this.session.term.key : null
    this.categories.setData(this.session.categoryRows()).then(() => {
      if (keep && this.categories.getRow(keep)) this.categories.selectRow(keep)
    })
  }

  selectTerm (term) {
    this.session.selectTerm(term)
    this.shell.colorBy = this.session.colorBy
    this.shell.status = this.session.termStatus(term)
    this.proteins.refreshFilter()
    this.applySiteFilter()
  }

  clearTerm () {
    this.session.clearTerm()
    this.shell.colorBy = this.session.colorBy
    this.shell.status = ''
    this.proteins.refreshFilter()
    this.applySiteFilter()
  }

  applySiteFilter () {
    this.sites.setFilter((row) => this.session.siteVisible(row))
  }

  async openProtein (accession) {
    const entry = this.session.proteins.find((p) => p.uniprot_acc === accession)
    if (!entry) return
    this.proteins.deselectRow()
    this.proteins.selectRow(accession)
    const payload = await loadPayload(entry.data_file)
    const pdbText = await loadText(payload.pdb_file)
    this.session.setProtein(payload)
    this.currentProtein = entry
    this.viewers.setModel(pdbText)
    clearFigure(this.ntocHost)
    this.shell.proteinLabel = this.session.proteinLabel
    this.shell.pmlFile = entry.pml_file
    this.shell.status = ''
    await this.sites.setData(this.session.ptms)
    this.applySiteFilter()
    this.apply({ type: 'workspace', value: 'protein' })
  }

  showSite (p) {
    this.session.highlight(p)
    this.shell.status = this.session.siteStatus(p)
    this.draw()
    this.viewers.center(p)
  }

  clearSite () {
    this.session.highlight(null)
    this.shell.status = ''
    this.draw()
  }

  /** A click on a sphere or a lollipop head routes through the table's selection when it can. */
  selectRowFor (p) {
    const row = this.sites
      .getRows('active')
      .find((r) => r.getData().site === p.site && r.getData().contrast === p.contrast)
    if (row) {
      this.sites.deselectRow()
      row.select()
    } else {
      this.showSite(p)
    }
  }

  draw () {
    const { session, shell } = this
    if (!session.protein) return
    const rows = session.rows(this.visibleSites)
    this.viewers.render(rows, session.styleChoice, session.highlighted, (p) => this.selectRowFor(p))
    if (!rows.length) {
      clearFigure(this.ntocHost)
      return
    }
    shell.ntocHeight = Math.min(150 * rows.length + 100, Math.round(window.innerHeight * 0.45))
    const figure = ntocFigure({
      rows,
      proteinLength: session.protein.protein_length || session.protein.seq_len,
      proteinLog2fc: session.protein.protein_log2fc || {},
      fdrThreshold: session.fdrThreshold,
      highlighted: session.highlighted
    })
    this.ntocRecords = figure.records
    renderFigure(this.ntocHost, figure, {
      height: shell.ntocHeight - 24,
      onClick: (index) => this.selectRowFor(this.ntocRecords[index])
    })
  }
}

async function main () {
  const shell = document.querySelector('ptm-app')
  let catalog
  let categories
  try {
    ;[catalog, categories] = await Promise.all([loadCatalog(), loadCategories()])
  } catch (error) {
    shell.meta = 'Could not load the data/ catalog - serve this folder over HTTP (proptm3d serve).'
    throw error
  }
  const app = new App(shell, new Session(catalog, categories))
  shell.app = app // Exposed for browser-side inspection and tests.
  await app.start()
}

main()
