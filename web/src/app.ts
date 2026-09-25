import { LitElement, html } from 'lit'
import { TabulatorFull, type ColumnDefinition } from 'tabulator-tables'
import { buildAbundanceFigure, buildNtoCFigure, buildProteinSiteFigure, buildVolcanoFigure, focusProteinTraces, plotThresholds, proteinBackgroundPoints, renderFigure, type FigureSpec, type PlotBackground, type ProteinTraceUpdate } from './charts.js'
import { loadAppData, loadProteinDetail } from './data.js'
import { buildDetailRows, displayProteinDescription, selectDetailRows, type DetailRow, type EstimateType } from './detail.js'
import { computeLogos } from './logo.js'
import { renderLogo } from './logo-view.js'
import { buildPaeFigure, loadPae, paeBlockSize, paeModelFor, renderPae } from './pae.js'
import { servedUrl } from './served-url.js'
import { ALL_STRUCTURES, exposureLabel, isStructurallyFiltered, passesStructuralFilters, plddtLabel, regionLabel, structureDetail, structureLabel, type ExposureFilter, type RegionFilter, type StructuralFilters } from './structural.js'
import { summarizeProteins, validCutoffs, type ProteinSummary } from './summary.js'
import type { AppData, ProteinCatalogRow, ProteinDetail, SiteStructure, Thresholds } from './types.js'
import type { SiteMarker, StructureViewer } from './structure.js'
import type { StructureColoring } from './structure-colors.js'

type MainView = 'find' | 'protein' | 'abundance'
type FindView = 'all' | 'single' | 'sequlogos'
type DetailView = 'structure' | 'ntoc' | 'pae'
type PlotBackgrounds = { schema_version: '1'; plots: Record<string, {
  volcano: PlotBackground; protein_site: PlotBackground
}> }

async function loadPlotBackgrounds(baseUrl = document.baseURI): Promise<PlotBackgrounds> {
  const response = await fetch(servedUrl('data/plot_backgrounds.json', baseUrl), {
    mode: 'same-origin', redirect: 'error',
  })
  if (!response.ok) throw new Error(`Could not load plot backgrounds: HTTP ${response.status}`)
  const backgrounds = await response.json() as PlotBackgrounds
  if (backgrounds.schema_version !== '1') throw new Error('Unsupported plot background schema.')
  for (const plots of Object.values(backgrounds.plots)) {
    plots.volcano.file = servedUrl(plots.volcano.file, baseUrl).href
    plots.protein_site.file = servedUrl(plots.protein_site.file, baseUrl).href
  }
  return backgrounds
}

function residueLabel(row: Pick<DetailRow, 'site' | 'modAA' | 'posInProtein'>): string {
  return row.modAA && row.posInProtein !== null ? `${row.modAA}${row.posInProtein}` : row.site
}

function structureCell(structure: SiteStructure, label: string): string {
  const span = document.createElement('span')
  span.textContent = label
  span.title = structureDetail(structure)
  return span.outerHTML
}

function numberLabel(value: number | null, digits = 3): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(digits)
}

class PtmBrowserApp extends LitElement {
  private data: AppData | null = null
  private plotBackgrounds: PlotBackgrounds | null = null
  private detail: ProteinDetail | null = null
  private detailCache = new Map<string, ProteinDetail>()
  private findTable: TabulatorFull | null = null
  private detailTable: TabulatorFull | null = null
  private abundanceTable: TabulatorFull | null = null
  private viewer: StructureViewer | null = null
  private mainView: MainView = 'find'
  private findView: FindView = 'all'
  private detailView: DetailView = 'structure'
  private displayedContrast = ''
  private estimateType: EstimateType = 'all'
  private showAllSites = false
  private structural: StructuralFilters = ALL_STRUCTURES
  private paeLoadId = 0
  private selectedSite: string | null = null
  private thresholds: Thresholds = { fdr: 0.05, absEffect: 1 }
  private detailLoadId = 0
  private renderedFindPlotKey: string | null = null
  private findPlotInProgress = false
  private findPlotFrame: number | null = null
  private findPlotTimer: number | null = null
  private resizeFindPlotsAfterRender = false
  private focusedFigures: { volcano: FigureSpec; proteinSite: FigureSpec } | null = null
  private hoveredProteinId: string | null = null
  private focusPlotsPending = false
  private focusPlotsInProgress = false
  private focusPlotsIdle: Promise<void> = Promise.resolve()
  private resolveFocusPlotsIdle: (() => void) | null = null

  protected createRenderRoot(): HTMLElement { return this }

  protected render() {
    return html`
      <header class="masthead">
        <div class="brand"><div class="brand-mark">3D</div><div><h1>proptm3d</h1><p>Phosphosite structure explorer</p></div></div>
        <div class="run-meta"><span id="method-pill" class="pill method">Loading</span><span id="run-counts" class="pill"></span></div>
        <div id="app-status" class="status" role="status">Loading prepared data…</div>
        <button id="guide-toggle" class="guide-toggle" type="button" aria-controls="reading-guide" aria-expanded="false" @click=${() => this.toggleGuide()}>How to read this</button>
      </header>
      <aside id="reading-guide" class="reading-guide" aria-label="Data and color explanations" hidden @keydown=${(event: KeyboardEvent) => { if (event.key === 'Escape') this.toggleGuide(false) }}>
        <div class="guide-heading"><h2>How to read this</h2><button type="button" aria-label="Close explanations" @click=${() => this.toggleGuide(false)}>×</button></div>
        <dl>
          <dt>Estimate</dt><dd>Observed uses measured site abundance. LOD imputed means a value below the limit of detection was imputed in the upstream analysis. All does not filter by estimate type; use Show all sites in Protein detail to include sites without a passing result.</dd>
          <dt>Exposure</dt><dd>Predicted residue exposure from the AlphaFold model, using the PAE-aware StructureMap neighborhood. Exposed means at most five qualifying neighbors in a 12 Å, 70° partial sphere; buried means more than five. This is not an experimental measurement of solvent accessibility.</dd>
          <dt>Region</dt><dd>IDR means predicted intrinsically disordered region; structured means not classified as IDR. The call uses smoothed PAE-aware neighbors in a 24 Å sphere. Sites without matched model context are neither category.</dd>
          <dt>pLDDT</dt><dd>AlphaFold's per-residue local confidence score, 0–100; higher is more confident. It is not an exposure or disorder measurement.</dd>
          <dt>UniProt features</dt><dd>Prepared UniProt domains, regions, motifs, repeats, transmembrane segments and signal peptides. Generic Chain intervals are not colored. Only exact coordinates on a sequence-matched protein are colored; unannotated residues are gray. More specific feature types take precedence where intervals overlap.</dd>
          <dt>FDR and |log2FC|</dt><dd>A site passes only when FDR is strictly below the selected cutoff and absolute log2 fold change is strictly above the selected cutoff. These filters do not change the underlying abundance values.</dd>
        </dl>
      </aside>
      <div class="controls global-filters" role="group" aria-label="Site filters">
        <div class="control threshold"><label for="fdr-cutoff">FDR &lt;</label><input id="fdr-cutoff" type="number" min="0" max="1" step="0.01" value="0.05" @input=${() => this.changeThresholds()} /></div>
        <div class="control threshold"><label for="effect-cutoff">|log2FC| &gt;</label><input id="effect-cutoff" type="number" min="0" step="0.1" value="1" @input=${() => this.changeThresholds()} /></div>
        <div class="control global-contrast"><label for="displayed-contrast">Displayed contrast</label><select id="displayed-contrast" @change=${(event: Event) => this.changeDisplayedContrast(event)}></select></div>
        <div class="control estimate"><label for="estimate-type">Estimate</label><select id="estimate-type" @change=${(event: Event) => this.changeEstimateType(event)}><option value="all">All</option><option value="observed">Observed</option><option value="lod_imputed">LOD imputed</option></select></div>
        <div class="control structural"><label for="exposure-filter">Exposure</label><select id="exposure-filter" title="Bludau prediction-aware exposure; sites without matched AlphaFold context are excluded unless All" @change=${() => this.changeStructuralFilters()}><option value="all">All</option><option value="exposed">Exposed</option><option value="buried">Buried</option></select></div>
        <div class="control structural"><label for="region-filter">Region</label><select id="region-filter" title="Bludau prediction-aware intrinsically disordered region; sites without matched AlphaFold context are excluded unless All" @change=${() => this.changeStructuralFilters()}><option value="all">All</option><option value="idr">IDR</option><option value="structured">Structured</option></select></div>
        <div class="control global-search"><label for="find-search">Search</label><input id="find-search" type="search" placeholder="Gene, ID or accession" @input=${() => this.refreshSummary()} /></div>
      </div>
      <nav class="main-tabs" aria-label="Workspaces">
        <button type="button" data-main="find" aria-selected="true" @click=${() => this.showMain('find')}>Find proteins</button>
        <button type="button" data-main="protein" aria-selected="false" @click=${() => this.showMain('protein')}>Protein detail</button>
        <button type="button" data-main="abundance" aria-selected="false" @click=${() => this.showMain('abundance')}>Site abundance</button>
      </nav>
      <main>
        <section id="find-workspace" class="workspace" aria-label="Find proteins">
          <nav class="find-tabs" aria-label="Find scope">
            <button type="button" data-find="all" aria-selected="true" @click=${() => this.showFind('all')}>All contrasts</button>
            <button type="button" data-find="single" aria-selected="false" @click=${() => this.showFind('single')}>Single contrast</button>
            <button type="button" data-find="sequlogos" aria-selected="false" @click=${() => this.showFind('sequlogos')}>Single contrast sequlogos</button>
          </nav>
          <div id="find-grid" class="find-grid all-contrasts">
            <div class="card"><div class="card-title"><span id="find-count" class="scope-count">Proteins</span><small id="find-row-hint">Click a row to inspect its sites</small></div><div class="card-body flush"><div id="find-table" class="table-host"></div></div></div>
            <div id="focused-plots" class="focused-plots" hidden>
              <div class="card"><div class="card-body"><div id="focus-volcano-plot" class="plot-host"></div></div></div>
              <div class="card"><div class="card-body"><div id="focus-protein-site-plot" class="plot-host"></div><div id="focus-protein-site-note" class="metric-note"></div></div></div>
            </div>
          </div>
          <div id="find-plots" class="plot-grid" hidden>
            <div class="card"><div class="card-body"><div id="volcano-plot" class="plot-host"></div></div></div>
            <div class="card"><div class="card-body"><div id="protein-site-plot" class="plot-host"></div><div id="protein-site-note" class="metric-note"></div></div></div>
            <div class="logos">
              <div class="card"><div class="card-title">Up <small id="up-count"></small></div><div id="up-logo" class="logo-host"></div></div>
              <div class="card"><div class="card-title">Down <small id="down-count"></small></div><div id="down-logo" class="logo-host"></div></div>
              <div class="card"><div class="card-title">Up − Down <small>amino-acid frequency difference</small></div><div id="difference-logo" class="logo-host"></div></div>
              <div id="logo-note" class="metric-note"></div>
            </div>
          </div>
        </section>
        <section id="protein-workspace" class="workspace" hidden>
          <div class="workspace-heading protein-heading">
            <div class="protein-heading-copy">
              <div class="protein-heading-line"><h2 id="protein-heading">Choose a protein</h2><span id="protein-info" class="protein-info"></span></div>
              <div class="protein-description-row">
                <p id="protein-description" class="protein-description" hidden></p>
                <span id="protein-links" class="protein-links" hidden>
                  <a id="uniprot-link" target="_blank" rel="noopener noreferrer">UniProt ↗</a>
                  <a id="string-link" target="_blank" rel="noopener noreferrer">STRING ↗</a>
                </span>
              </div>
            </div>
            <label id="show-all-sites-label" class="show-all-sites" hidden><input id="show-all-sites" type="checkbox" @change=${() => this.changeShowAllSites()} /> Show all sites</label>
          </div>
          <div id="protein-content" hidden>
            <div class="protein-grid">
              <div class="card"><div class="card-title">Sites and results <small id="detail-count"></small></div><div class="card-body flush"><div id="detail-table" class="table-host detail-table"></div></div><div class="metric-note">Click a row to select its site.</div></div>
              <div class="detail-views">
                <nav class="detail-tabs" aria-label="Protein views">
                  <button type="button" data-detail="structure" aria-selected="true" @click=${() => this.showDetailView('structure')}>3D structure</button>
                  <button type="button" data-detail="ntoc" aria-selected="false" @click=${() => this.showDetailView('ntoc')}>N-to-C lollipop</button>
                  <button type="button" data-detail="pae" aria-selected="false" @click=${() => this.showDetailView('pae')}>PAE</button>
                </nav>
                <div id="structure-panel" class="card"><div class="view-note">Red up · blue down · gray no effect</div>
                  <div class="viewer-controls">
                    <div class="control"><label for="structure-representation">Representation</label><select id="structure-representation" @change=${() => this.changeStructureStyle()}><option value="cartoon">Cartoon</option><option value="backbone">Backbone trace</option><option value="surface">Surface</option></select></div>
                    <div class="control"><label for="structure-coloring">Structure color</label><select id="structure-coloring" @change=${() => this.changeStructureStyle()}><option value="plddt">pLDDT confidence</option><option value="exposure">Exposure</option><option value="region">Region / IDR</option><option value="uniprot">UniProt features</option><option value="position">N-to-C position</option><option value="neutral">Neutral</option></select></div>
                  </div>
                  <div id="structure-color-legend" class="structure-color-legend">pLDDT: blue high confidence · yellow/orange lower confidence</div>
                  <div id="uniprot-color-legend" class="structure-feature-legend" hidden>
                    <span><i style="background:#d28b3b"></i>Motif</span><span><i style="background:#59a276"></i>Signal</span><span><i style="background:#c56551"></i>Transmembrane</span><span><i style="background:#4c9699"></i>Repeat</span><span><i style="background:#8866a6"></i>Region</span><span><i style="background:#526da7"></i>Domain</span><span><i style="background:#a9b6c3"></i>No exact feature</span>
                  </div>
                  <div id="structure-view" class="structure-host"></div><div id="structure-status" class="viewer-status" role="status"></div>
                </div>
                <div id="ntoc-panel" class="card" hidden><div class="view-note">Sticks: method log2FC · dashed/open: imputed · ×: no estimate</div><div id="ntoc-plot" class="ntoc-host"></div></div>
                <div id="pae-panel" class="card" hidden><div class="view-note">Predicted aligned error · dark: confident relative placement · light: uncertain relative placement · dotted: selected site</div><div id="pae-plot" class="pae-host"></div><div id="pae-status" class="viewer-status" role="status"></div></div>
              </div>
            </div>
            <div class="controls" style="margin-top:0.9rem"><button type="button" @click=${() => this.showMain('abundance')}>Open selected site's abundance →</button><span id="selected-site-note" class="subtle"></span></div>
          </div>
          <p id="protein-empty" class="empty-note">Choose a protein from Find or a plotted point.</p>
        </section>
        <section id="abundance-workspace" class="workspace" aria-label="Site abundance" hidden>
          <div id="abundance-content" hidden>
            <div class="protein-grid">
              <div class="card"><div class="card-title">Sites <small id="abundance-context"></small></div><div class="card-body flush"><div id="abundance-table" class="table-host detail-table"></div></div><div class="metric-note">Hover a row to show its abundance · click to open it in 3D.</div></div>
              <div class="card abundance-host"><div class="view-note">Dots are samples; missing values are not set to zero.</div><div id="abundance-plot" class="plot-host"></div></div>
            </div>
          </div>
          <p id="abundance-empty" class="empty-note">Choose a protein and site first.</p>
        </section>
      </main>`
  }

  protected firstUpdated(): void { void this.start() }

  private toggleGuide(open = this.el('#reading-guide').hidden): void {
    this.el('#reading-guide').hidden = !open
    this.el('#guide-toggle').setAttribute('aria-expanded', String(open))
    if (open) this.el<HTMLButtonElement>('#reading-guide button').focus()
    else this.el<HTMLButtonElement>('#guide-toggle').focus()
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    if (this.findPlotFrame !== null) window.cancelAnimationFrame(this.findPlotFrame)
    if (this.findPlotTimer !== null) window.clearTimeout(this.findPlotTimer)
    this.viewer?.dispose()
    this.findTable?.destroy()
    this.detailTable?.destroy()
    this.abundanceTable?.destroy()
  }

  private el<T extends HTMLElement>(selector: string): T {
    const element = this.querySelector<T>(selector)
    if (!element) throw new Error(`Missing browser view element ${selector}`)
    return element
  }

  private setStatus(message: string, error = false): void {
    const status = this.el<HTMLDivElement>('#app-status')
    status.textContent = message
    status.classList.toggle('error', error)
  }

  private async start(): Promise<void> {
    try {
      const [data, plotBackgrounds] = await Promise.all([loadAppData(), loadPlotBackgrounds()])
      this.data = data
      this.plotBackgrounds = plotBackgrounds
      if (!data.run.contrasts.every((contrast) => plotBackgrounds.plots[contrast])) {
        throw new Error('Precomputed plot backgrounds are missing for a contrast.')
      }
      this.displayedContrast = this.data.run.contrasts[0] ?? ''
      this.el('#method-pill').textContent = this.data.run.method
      this.el('#run-counts').textContent = `${this.data.run.counts.proteins.toLocaleString()} proteins · ${this.data.run.counts.measured_sites.toLocaleString()} measured sites`
      this.populateContrasts()
      this.refreshSummary()
      this.setStatus('Ready · local prepared data')
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), true)
    }
  }

  private populateContrasts(): void {
    const select = this.el<HTMLSelectElement>('#displayed-contrast')
    select.replaceChildren()
    for (const contrast of this.data?.run.contrasts ?? []) {
      select.add(new Option(contrast, contrast))
    }
    select.value = this.displayedContrast
  }

  private showMain(view: MainView): void {
    if (view !== 'find') {
      this.setHoveredProtein(null)
      this.renderedFindPlotKey = null
    }
    this.mainView = view
    for (const tab of this.querySelectorAll<HTMLButtonElement>('[data-main]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.main === view))
    }
    for (const name of ['find', 'protein', 'abundance'] as MainView[]) {
      this.el(`#${name}-workspace`).hidden = name !== view
    }
    if (view === 'find' && this.findView !== 'all') {
      const resizePlots = this.renderedFindPlotKey !== null || this.findPlotInProgress
      this.requestFindPlots()
      if (resizePlots) void this.resizeFindPlots()
    }
    if (view === 'protein') this.showDetailView(this.detailView)
    if (view === 'abundance') void this.refreshAbundance()
  }

  private showFind(view: FindView): void {
    if (view !== 'single') this.setHoveredProtein(null)
    if (view !== this.findView) this.renderedFindPlotKey = null
    this.findView = view
    for (const tab of this.querySelectorAll<HTMLButtonElement>('[data-find]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.find === view))
    }
    this.el('#find-grid').hidden = view === 'sequlogos'
    this.el('#focused-plots').hidden = view !== 'single'
    this.el('#find-plots').hidden = view !== 'sequlogos'
    this.el('#find-row-hint').textContent = view === 'single'
      ? 'Hover a row to isolate its plotted sites · click for details'
      : 'Click a row to inspect its sites'
    this.el('#find-grid').classList.toggle('all-contrasts', view === 'all')
    if (view !== 'sequlogos') this.refreshSummary()
    if (view !== 'all') {
      const resizePlots = this.renderedFindPlotKey !== null || this.findPlotInProgress
      this.requestFindPlots()
      if (resizePlots) void this.resizeFindPlots()
    }
  }

  private changeDisplayedContrast(event: Event): void {
    this.displayedContrast = (event.target as HTMLSelectElement).value
    this.refreshSummary()
    this.requestFindPlots()
    if (this.detail) void this.refreshDetail()
  }

  private changeEstimateType(event: Event): void {
    this.estimateType = (event.target as HTMLSelectElement).value as EstimateType
    this.refreshSummary()
    this.requestFindPlots()
    if (this.detail) void this.refreshDetail()
  }

  private changeStructuralFilters(): void {
    this.structural = {
      exposure: this.el<HTMLSelectElement>('#exposure-filter').value as ExposureFilter,
      region: this.el<HTMLSelectElement>('#region-filter').value as RegionFilter,
    }
    this.refreshSummary()
    this.requestFindPlots()
    if (this.detail) void this.refreshDetail()
  }

  private changeShowAllSites(): void {
    this.showAllSites = this.el<HTMLInputElement>('#show-all-sites').checked
    if (this.detail) void this.refreshDetail()
  }

  private showDetailView(view: DetailView): void {
    this.detailView = view
    for (const tab of this.querySelectorAll<HTMLButtonElement>('[data-detail]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.detail === view))
    }
    this.el('#structure-panel').hidden = view !== 'structure'
    this.el('#ntoc-panel').hidden = view !== 'ntoc'
    this.el('#pae-panel').hidden = view !== 'pae'
    if (this.mainView !== 'protein') return
    if (view === 'structure') this.viewer?.resize()
    else if (view === 'ntoc' && this.detail) void this.refreshNtoC()
    else if (view === 'pae') void this.refreshPae()
  }

  private changeThresholds(): void {
    const fdr = Number(this.el<HTMLInputElement>('#fdr-cutoff').value)
    const absEffect = Number(this.el<HTMLInputElement>('#effect-cutoff').value)
    if (!validCutoffs({ fdr, absEffect })) {
      this.setStatus('Use an FDR in (0, 1] and a |log2FC| cutoff of at least 0.', true)
      return
    }
    this.setStatus('Ready · local prepared data')
    if (fdr === this.thresholds.fdr && absEffect === this.thresholds.absEffect) return
    this.thresholds = { fdr, absEffect }
    this.refreshSummary()
    this.requestFindPlots(true)
    if (this.detail) void this.refreshDetail()
  }

  /** The site set shared by every Find view: estimate type and structural filters, never significance. */
  private visibleSiteIndex() {
    const index = this.data!.siteIndex
    if (this.estimateType === 'all' && !isStructurallyFiltered(this.structural)) return index
    return index.filter((row) => (this.estimateType === 'all' || row.site_estimate_type === this.estimateType)
      && passesStructuralFilters(row.structure, this.structural))
  }

  private refreshSummary(): void {
    if (!this.data) return
    this.setHoveredProtein(null)
    const contrast = this.findView === 'all' ? null : this.displayedContrast
    const summaries = summarizeProteins(this.data.proteins, this.visibleSiteIndex(), contrast, this.thresholds)
    const search = this.el<HTMLInputElement>('#find-search').value.trim().toLocaleLowerCase()
    const matching = search ? summaries.filter((row) => [row.gene_name, row.accession, row.protein_Id]
      .some((value) => value?.toLocaleLowerCase().includes(search))) : summaries
    this.el('#find-count').textContent = `${matching.length.toLocaleString()} / ${summaries.length.toLocaleString()} proteins`
    if (!this.findTable) this.createFindTable(matching)
    else void this.findTable.replaceData(matching)
  }

  private findPlotKey(): string {
    return [this.findView, this.displayedContrast, this.estimateType, this.thresholds.fdr,
      this.thresholds.absEffect, this.structural.exposure, this.structural.region].join('\u0000')
  }

  private requestFindPlots(debounce = false): void {
    if (this.findPlotFrame !== null) window.cancelAnimationFrame(this.findPlotFrame)
    this.findPlotFrame = null
    if (this.findPlotTimer !== null) window.clearTimeout(this.findPlotTimer)
    this.findPlotTimer = null
    if (!this.data || this.findView === 'all' || this.mainView !== 'find') return
    if (this.renderedFindPlotKey === this.findPlotKey()) return
    if (debounce) {
      this.findPlotTimer = window.setTimeout(() => {
        this.findPlotTimer = null
        void this.refreshFindPlots()
      }, 200)
    } else {
      this.findPlotFrame = window.requestAnimationFrame(() => {
        this.findPlotFrame = null
        this.findPlotTimer = window.setTimeout(() => {
          this.findPlotTimer = null
          void this.refreshFindPlots()
        }, 0)
      })
    }
  }

  private async resizeFindPlots(): Promise<void> {
    if (this.mainView !== 'find') return
    if (this.findPlotInProgress) {
      this.resizeFindPlotsAfterRender = true
      return
    }
    if (this.renderedFindPlotKey === null) return
    try {
      const Plotly = (await import('plotly.js-gl2d-dist-min')).default
      if (this.findView === 'all' || this.mainView !== 'find' || this.findPlotInProgress) return
      if (this.findView === 'single') {
        Plotly.Plots.resize(this.el('#focus-volcano-plot'))
        Plotly.Plots.resize(this.el('#focus-protein-site-plot'))
      }
      else {
        Plotly.Plots.resize(this.el('#volcano-plot'))
        Plotly.Plots.resize(this.el('#protein-site-plot'))
      }
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), true)
    }
  }

  private createFindTable(rows: ProteinSummary[]): void {
    const columns: ColumnDefinition[] = [
      { title: 'Gene', field: 'gene_name', frozen: true, minWidth: 105 },
      { title: 'Accession', field: 'accession', minWidth: 110 },
      { title: 'Measured sites', field: 'measured_sites', hozAlign: 'right', sorter: 'number', minWidth: 115 },
      { title: 'Tested sites', field: 'tested_sites', hozAlign: 'right', sorter: 'number', minWidth: 105 },
      { title: 'Significant sites', field: 'significant_sites', hozAlign: 'right', sorter: 'number', minWidth: 125 },
      { title: 'Up pairs', field: 'up_pairs', hozAlign: 'right', sorter: 'number', minWidth: 95,
        tooltip: 'Significant site–contrast pairs with positive effect' },
      { title: 'Down pairs', field: 'down_pairs', hozAlign: 'right', sorter: 'number', minWidth: 105,
        tooltip: 'Significant site–contrast pairs with negative effect' },
      { title: 'Largest |log2FC|', field: 'largest_effect', hozAlign: 'right', sorter: 'number', minWidth: 135,
        formatter: (cell) => numberLabel(cell.getValue() as number | null) },
      { title: 'Protein ID', field: 'protein_Id', minWidth: 125 },
    ]
    this.findTable = new TabulatorFull(this.el('#find-table'), {
      data: rows, columns, columnDefaults: { headerWordWrap: true, headerTooltip: true },
      index: 'protein_Id', layout: 'fitColumns',
      initialSort: [{ column: 'significant_sites', dir: 'desc' }], placeholder: 'No proteins match the current search.',
    })
    this.findTable.on('rowClick', (_event, row) => {
      void this.openProtein(row.getData() as ProteinCatalogRow)
    })
    this.findTable.on('rowMouseEnter', (_event, row) => {
      if (this.findView === 'single' && this.mainView === 'find') {
        this.setHoveredProtein((row.getData() as ProteinCatalogRow).protein_Id)
      }
    })
    this.findTable.on('rowMouseLeave', (_event, row) => {
      if (this.hoveredProteinId === (row.getData() as ProteinCatalogRow).protein_Id) {
        this.setHoveredProtein(null)
      }
    })
    this.findTable.on('dataFiltered', (_filters, visible) => {
      this.el('#find-count').textContent = `${visible.length.toLocaleString()} / ${this.data!.proteins.length.toLocaleString()} proteins`
    })
  }

  private setHoveredProtein(proteinId: string | null): void {
    if (this.hoveredProteinId === proteinId) return
    this.hoveredProteinId = proteinId
    void this.applyFindFocus()
  }

  private async applyFindFocus(): Promise<void> {
    if (this.findView !== 'single' || !this.focusedFigures || this.renderedFindPlotKey !== this.findPlotKey()) return
    this.focusPlotsPending = true
    if (this.focusPlotsInProgress) return
    this.focusPlotsInProgress = true
    this.focusPlotsIdle = new Promise((resolve) => { this.resolveFocusPlotsIdle = resolve })
    try {
      const Plotly = (await import('plotly.js-gl2d-dist-min')).default
      while (this.focusPlotsPending) {
        this.focusPlotsPending = false
        const figures: { volcano: FigureSpec; proteinSite: FigureSpec } | null = this.focusedFigures
        if (this.findView !== 'single' || !figures || this.renderedFindPlotKey !== this.findPlotKey()) continue
        const proteinId = this.hoveredProteinId
        const layoutUpdate = { 'images[0].visible': proteinId === null }
        const volcanoUpdate: ProteinTraceUpdate = focusProteinTraces(figures.volcano, proteinId)
        const scatterUpdate: ProteinTraceUpdate = focusProteinTraces(figures.proteinSite, proteinId)
        if (proteinId !== null) {
          const rows = this.visibleSiteIndex()
          const plotted = plotThresholds(this.thresholds)
          const volcanoPoints = proteinBackgroundPoints(rows, proteinId, this.displayedContrast,
            'volcano', plotted.fdr, plotted.absEffect)
          const scatterPoints = proteinBackgroundPoints(rows, proteinId, this.displayedContrast,
            'protein-site', plotted.fdr, plotted.absEffect)
          volcanoUpdate.x[2] = volcanoPoints.x
          volcanoUpdate.y[2] = volcanoPoints.y
          volcanoUpdate.customdata[2] = volcanoPoints.customdata
          scatterUpdate.x[2] = scatterPoints.x
          scatterUpdate.y[2] = scatterPoints.y
          scatterUpdate.customdata[2] = scatterPoints.customdata
        }
        await Promise.all([
          Plotly.update(this.el<HTMLDivElement>('#focus-volcano-plot'),
            volcanoUpdate, layoutUpdate, [0, 1, 2]),
          Plotly.update(this.el<HTMLDivElement>('#focus-protein-site-plot'),
            scatterUpdate, layoutUpdate, [0, 1, 2]),
        ])
        if (proteinId !== this.hoveredProteinId || figures !== this.focusedFigures) {
          this.focusPlotsPending = true
        }
      }
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), true)
    } finally {
      this.focusPlotsInProgress = false
      this.resolveFocusPlotsIdle?.()
      this.resolveFocusPlotsIdle = null
    }
  }

  private async refreshFindPlots(): Promise<void> {
    if (!this.data || this.mainView !== 'find' || this.findPlotInProgress) return
    if (this.renderedFindPlotKey === this.findPlotKey()) return
    this.findPlotInProgress = true
    try {
      while (this.mainView === 'find') {
        const view: FindView = this.findView
        if (view === 'all') break
        const key = this.findPlotKey()
        if (this.renderedFindPlotKey === key || this.findPlotTimer !== null) break
        const siteIndex = this.visibleSiteIndex()
        const contrast = this.displayedContrast
        const thresholds = plotThresholds(this.thresholds)
        const backgrounds = this.plotBackgrounds?.plots[contrast]
        if (!backgrounds) throw new Error(`Precomputed plot backgrounds are missing for ${contrast}.`)
        const volcano = buildVolcanoFigure(siteIndex, contrast, thresholds.fdr, thresholds.absEffect, backgrounds.volcano)
        await this.focusPlotsIdle
        if (this.mainView !== 'find') break
        if (key !== this.findPlotKey()) continue
        this.focusedFigures = null
        this.renderedFindPlotKey = null
        const onClick = (point: { proteinId: string; site: string; contrast: string }) => {
          const protein = this.data?.proteins.find((row) => row.protein_Id === point.proteinId)
          if (protein) void this.openProtein(protein, point.site, point.contrast)
        }
        if (view === 'single') {
          const scatter = buildProteinSiteFigure(siteIndex, contrast, thresholds.fdr, thresholds.absEffect,
            backgrounds.protein_site)
          this.el('#focus-protein-site-note').textContent = scatter.missingCount > 0
            ? `${scatter.missingCount.toLocaleString()} site results have no complete protein/site fold-change pair.`
            : 'All site results have protein and original-site effects.'
          const focusBase = structuredClone({ volcano, proteinSite: scatter.figure })
          const renders = await Promise.allSettled([
            renderFigure(this.el<HTMLDivElement>('#focus-volcano-plot'), volcano, onClick, 'gl2d'),
            renderFigure(this.el<HTMLDivElement>('#focus-protein-site-plot'), scatter.figure, onClick, 'gl2d'),
          ])
          const failed = renders.find((result) => result.status === 'rejected')
          if (failed?.status === 'rejected') throw failed.reason
          this.focusedFigures = focusBase
        } else {
          const scatter = buildProteinSiteFigure(siteIndex, contrast, thresholds.fdr, thresholds.absEffect,
            backgrounds.protein_site)
          const logos = computeLogos(siteIndex, contrast, thresholds)
          this.el('#protein-site-note').textContent = scatter.missingCount > 0
            ? `${scatter.missingCount.toLocaleString()} site results have no complete protein/site fold-change pair.` : 'All site results have protein and original-site effects.'
          this.el('#up-count').textContent = `${logos.upCount.toLocaleString()} sites`
          this.el('#down-count').textContent = `${logos.downCount.toLocaleString()} sites`
          this.el('#logo-note').textContent = logos.invalidWindowCount > 0
            ? `${logos.invalidWindowCount.toLocaleString()} passing sites lacked a valid centered sequence window.`
            : '15-residue windows centered on the modified amino acid.'
          renderLogo(this.el('#up-logo'), logos.up, false, 'No qualifying up sites at these cutoffs.')
          renderLogo(this.el('#down-logo'), logos.down, false, 'No qualifying down sites at these cutoffs.')
          renderLogo(this.el('#difference-logo'), logos.difference, true, 'Both up and down sites are needed for a difference logo.')
          const renders = await Promise.allSettled([
            renderFigure(this.el<HTMLDivElement>('#volcano-plot'), volcano, onClick, 'gl2d'),
            renderFigure(this.el<HTMLDivElement>('#protein-site-plot'), scatter.figure, onClick, 'gl2d'),
          ])
          const failed = renders.find((result) => result.status === 'rejected')
          if (failed?.status === 'rejected') throw failed.reason
        }
        if (view !== this.findView || key !== this.findPlotKey()) continue
        this.renderedFindPlotKey = key
        if (view === 'single' && this.hoveredProteinId !== null) void this.applyFindFocus()
      }
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), true)
    } finally {
      this.findPlotInProgress = false
      if (this.resizeFindPlotsAfterRender) {
        this.resizeFindPlotsAfterRender = false
        void this.resizeFindPlots()
      }
    }
  }

  private async openProtein(protein: ProteinCatalogRow, site: string | null = null, contrast?: string): Promise<void> {
    const id = ++this.detailLoadId
    this.detail = null
    this.selectedSite = null
    this.detailView = 'structure'
    this.showMain('protein')
    this.el('#protein-heading').textContent = protein.gene_name || protein.protein_Id
    this.el('#protein-info').textContent = `${protein.accession} · ${protein.protein_Id}`
    const description = displayProteinDescription(protein.description)
    this.el('#protein-description').textContent = description ?? ''
    this.el('#protein-description').hidden = description === null
    const uniprotLink = this.el<HTMLAnchorElement>('#uniprot-link')
    const stringLink = this.el<HTMLAnchorElement>('#string-link')
    uniprotLink.hidden = !protein.uniprot_url
    stringLink.hidden = !protein.string_url
    if (protein.uniprot_url) uniprotLink.href = protein.uniprot_url
    if (protein.string_url) stringLink.href = protein.string_url
    this.el('#protein-links').hidden = !protein.uniprot_url && !protein.string_url
    this.el('#show-all-sites-label').hidden = true
    this.el('#protein-empty').textContent = 'Loading protein sites, evidence, and features…'
    this.el('#protein-empty').hidden = false
    this.el('#protein-content').hidden = true
    try {
      let detail = this.detailCache.get(protein.protein_Id)
      if (!detail) {
        detail = await loadProteinDetail(protein, this.data!.run)
        this.detailCache.set(protein.protein_Id, detail)
      }
      if (id !== this.detailLoadId) return
      this.detail = detail
      if (contrast) this.displayedContrast = contrast
      this.el<HTMLSelectElement>('#displayed-contrast').value = this.displayedContrast
      this.selectedSite = site
      this.el('#protein-empty').hidden = true
      this.el('#protein-content').hidden = false
      this.el('#protein-info').textContent = `${protein.accession} · ${protein.protein_Id} · ${detail.sites.length} measured sites · ${detail.structures.length} structures · annotation ${detail.features.status}`
      this.el('#show-all-sites-label').hidden = false
      this.showDetailView('structure')
      await this.refreshDetail(true)
    } catch (error) {
      if (id !== this.detailLoadId) return
      this.detail = null
      this.selectedSite = null
      this.el('#protein-content').hidden = true
      this.el('#show-all-sites-label').hidden = true
      this.el('#protein-empty').hidden = false
      this.el('#protein-empty').textContent = error instanceof Error ? error.message : String(error)
      this.setStatus(this.el('#protein-empty').textContent, true)
    }
  }

  private visibleDetailRows(): DetailRow[] {
    if (!this.detail) return []
    return selectDetailRows(this.detail, this.displayedContrast, this.thresholds,
      this.estimateType, this.showAllSites, this.structural)
  }

  private async refreshDetail(loadStructure = false): Promise<void> {
    if (!this.detail) return
    const rows = this.visibleDetailRows()
    if (!this.selectedSite || !rows.some((row) => row.site === this.selectedSite)) {
      this.selectedSite = rows[0]?.site ?? null
    }
    await this.refreshDetailTable(rows)
    await this.refreshDetailViews(loadStructure, rows)
    if (this.mainView === 'abundance') await this.refreshAbundance()
  }

  private async refreshDetailTable(rows: DetailRow[]): Promise<void> {
    if (!this.detail || !this.data) return
    const total = buildDetailRows(this.detail, this.displayedContrast, this.thresholds).length
    this.setDetailCount(rows, total)
    if (this.detailTable) {
      await this.detailTable.replaceData(rows)
      this.syncSelectedTableRow()
      return
    }
    this.detailTable = new TabulatorFull(this.el('#detail-table'), {
      data: rows, columns: this.siteColumns(), columnDefaults: { headerWordWrap: true, headerTooltip: true },
      index: 'row_id', layout: 'fitDataStretch',
      initialSort: [{ column: 'posInProtein', dir: 'asc' }], placeholder: 'No sites match the current filters.',
    })
    this.detailTable.on('rowClick', (_event, row) => {
      const value = row.getData() as DetailRow
      this.selectSite(value.site)
    })
    this.detailTable.on('tableBuilt', () => this.syncSelectedTableRow())
  }

  private siteColumns(): ColumnDefinition[] {
    return [
      { title: 'Site', field: 'site', frozen: true, width: 165, tooltip: true },
      { title: 'Pos.', field: 'posInProtein', sorter: 'number', hozAlign: 'right', width: 55 },
      { title: 'AA', field: 'modAA', width: 45 },
      { title: 'log2FC', field: 'effect', sorter: 'number', hozAlign: 'right', width: 77, formatter: (cell) => numberLabel(cell.getValue() as number | null) },
      { title: 'FDR', field: 'fdr', sorter: 'number', hozAlign: 'right', width: 70, formatter: (cell) => numberLabel(cell.getValue() as number | null, 4) },
      { title: 'Pass', field: 'passes_cutoff', width: 58, hozAlign: 'center', formatter: 'tickCross',
        headerTooltip: 'Passes the shared FDR and |log2FC| thresholds' },
      { title: 'Measured', field: 'has_measurement', width: 75, formatter: 'tickCross' },
      { title: 'Estimate', field: 'estimate_status', width: 115 },
      { title: 'Exposure', field: 'structure.exposure', width: 96,
        headerTooltip: 'Bludau prediction-aware exposure from AlphaFold coordinates and PAE; hover a cell for neighbor counts',
        formatter: (cell) => structureCell((cell.getData() as DetailRow).structure, exposureLabel((cell.getData() as DetailRow).structure)) },
      { title: 'Region', field: 'structure.region', width: 96,
        headerTooltip: 'Bludau prediction-aware intrinsically disordered region (IDR) or structured region',
        formatter: (cell) => structureCell((cell.getData() as DetailRow).structure, regionLabel((cell.getData() as DetailRow).structure)) },
      { title: 'pLDDT', field: 'structure.plddt', width: 62, hozAlign: 'right',
        headerTooltip: 'AlphaFold per-residue model confidence at the site; informational, not a filter',
        sorter: 'number',
        formatter: (cell) => plddtLabel((cell.getData() as DetailRow).structure) },
    ]
  }

  private setDetailCount(visible: DetailRow[], total: number): void {
    const count = visible.length === total ? `${total.toLocaleString()} sites`
      : `${visible.length.toLocaleString()} / ${total.toLocaleString()} sites`
    const passing = visible.filter((row) => row.passes_cutoff).length
    this.el('#detail-count').textContent = `${count} · ${passing.toLocaleString()} pass cutoffs`
  }

  private selectSite(site: string): void {
    if (!this.visibleDetailRows().some((row) => row.site === site)) return
    this.selectedSite = site
    this.syncSelectedTableRow()
    void this.refreshDetailViews(false, this.visibleDetailRows())
    if (this.mainView === 'abundance') void this.refreshAbundance()
  }

  private syncSelectedTableRow(): void {
    if (!this.detailTable || !this.selectedSite) return
    const rowId = `${this.selectedSite}\u0000${this.displayedContrast}`
    try {
      this.detailTable.deselectRow()
      this.detailTable?.selectRow(rowId)
      void this.detailTable?.scrollToRow(rowId, 'center', false).catch(() => {})
    } catch { /* The selected row may have been filtered out. */ }
  }

  private siteMarkers(rows: DetailRow[]): SiteMarker[] {
    return rows.map((row) => ({ site: row.site, label: residueLabel(row), posInProtein: row.posInProtein,
      effect: row.effect, fdr: row.fdr, structure: row.structure }))
  }

  private async refreshDetailViews(loadStructure: boolean, rows: DetailRow[]): Promise<void> {
    if (!this.detail) return
    const detail = this.detail
    const id = this.detailLoadId
    const selected = rows.find((row) => row.site === this.selectedSite)
    this.el('#selected-site-note').textContent = selected
      ? `Selected ${structureLabel(residueLabel(selected), selected.structure)} · ${this.displayedContrast}`
      : 'No site selected'
    if (this.detailView === 'ntoc') await this.refreshNtoC(rows)
    if (id !== this.detailLoadId || this.detail !== detail) return
    try {
      if (!this.viewer) {
        const { StructureViewer } = await import('./structure.js')
        if (id !== this.detailLoadId || this.detail !== detail) return
        this.viewer = new StructureViewer(this.el('#structure-view'), (site) => this.selectSite(site))
      }
      if (loadStructure) {
        this.el('#structure-status').textContent = 'Loading local AlphaFold model…'
        await this.viewer.load(detail.structures, this.siteMarkers(rows),
          detail.protein.sequence_length ?? detail.protein.protein_length,
          detail.residueContext,
          detail.features.status === 'matched' ? detail.features.features : [])
      }
      if (id !== this.detailLoadId || this.detail !== detail) return
      this.viewer.setSites(this.siteMarkers(this.visibleDetailRows()), this.selectedSite, {
        fdr: this.thresholds.fdr, minAbsoluteEffect: this.thresholds.absEffect,
      })
      this.el('#structure-status').textContent = this.viewer.status.message
      if (this.detailView === 'structure' && this.mainView === 'protein') this.viewer.resize()
    } catch (error) {
      this.el('#structure-status').textContent = error instanceof Error ? error.message : String(error)
    }
    await this.refreshPae()
  }

  /** Loads one model's PAE only while its tab is shown; follows the fragment shown in 3D. */
  private async refreshPae(): Promise<void> {
    const status = this.el('#pae-status')
    if (this.detailView !== 'pae' || this.mainView !== 'protein' || !this.detail) return
    const id = ++this.paeLoadId
    const detail = this.detail
    const selected = this.visibleDetailRows().find((row) => row.site === this.selectedSite) ?? null
    const position = selected?.posInProtein ?? null
    const model = paeModelFor(detail.structures, this.viewer?.activeFragment ?? null)
    const plot = this.el<HTMLDivElement>('#pae-plot')
    plot.hidden = true
    if (!model) { status.textContent = 'No AlphaFold model is available for this protein.'; return }
    if (!model.pae_url) { status.textContent = `No cached PAE matrix for AlphaFold fragment ${model.fragment}.`; return }
    status.textContent = `Loading PAE for AlphaFold fragment ${model.fragment}…`
    try {
      const matrix = await loadPae(model.pae_url)
      if (id !== this.paeLoadId || this.detail !== detail) return
      plot.hidden = false
      const figure = buildPaeFigure(matrix, model, position, detail.protein.gene_name || detail.protein.protein_Id)
      figure.layout.height = plot.clientHeight
      await renderPae(plot, figure, (clicked) => {
        const block = paeBlockSize(matrix.size)
        const site = this.visibleDetailRows().find((row) => row.posInProtein !== null
          && row.posInProtein >= clicked && row.posInProtein < clicked + block)
        if (site) this.selectSite(site.site)
      })
      status.textContent = `${matrix.size.toLocaleString()} residues · maximum PAE ${matrix.maxPae} Å`
        + (position === null ? '' : ` · guides at residue ${position}`)
    } catch (error) {
      if (id === this.paeLoadId) status.textContent = error instanceof Error ? error.message : String(error)
    }
  }

  private async refreshNtoC(rows = this.visibleDetailRows()): Promise<void> {
    if (!this.detail || this.mainView !== 'protein' || this.detailView !== 'ntoc' || !this.data) return
    try {
      const figure = buildNtoCFigure(this.detail, this.detail.features, this.data.run.method,
        this.displayedContrast, this.selectedSite, this.thresholds.fdr, this.thresholds.absEffect,
        new Set(rows.map((row) => row.site)))
      const plot = this.el<HTMLDivElement>('#ntoc-plot')
      figure.layout.height = plot.clientHeight
      await renderFigure(plot, figure, (point) => this.selectSite(point.site))
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), true)
    }
  }

  private changeStructureStyle(): void {
    if (!this.viewer) return
    this.viewer.setRepresentation(this.el<HTMLSelectElement>('#structure-representation').value as 'cartoon' | 'backbone' | 'surface')
    const coloring = this.el<HTMLSelectElement>('#structure-coloring').value as StructureColoring
    this.viewer.setColoring(coloring)
    const legends: Record<StructureColoring, string> = {
      plddt: 'pLDDT: blue high confidence · yellow/orange lower confidence',
      exposure: 'Exposure: teal exposed · amber buried · gray unavailable',
      region: 'Region: purple predicted IDR · blue structured · gray unavailable',
      uniprot: 'UniProt: colored feature type · gray no exact feature or sequence mismatch',
      position: 'N-to-C: blue N terminus → red C terminus',
      neutral: 'Neutral: all residues gray',
    }
    this.el('#structure-color-legend').textContent = legends[coloring]
    this.el('#uniprot-color-legend').hidden = coloring !== 'uniprot'
  }

  /** Hovering a row previews its boxplot; leaving restores the selected site; clicking opens it in 3D. */
  private refreshAbundanceTable(rows: DetailRow[]): void {
    if (this.abundanceTable) {
      void this.abundanceTable.replaceData(rows).then(() => this.syncSelectedAbundanceRow())
      return
    }
    this.abundanceTable = new TabulatorFull(this.el('#abundance-table'), {
      data: rows, columns: this.siteColumns(), columnDefaults: { headerWordWrap: true, headerTooltip: true },
      index: 'site', layout: 'fitDataStretch',
      initialSort: [{ column: 'posInProtein', dir: 'asc' }], placeholder: 'No sites match the current filters.',
    })
    this.abundanceTable.on('rowMouseEnter', (_event, row) => void this.renderAbundance((row.getData() as DetailRow).site))
    this.abundanceTable.on('rowMouseLeave', () => void this.renderAbundance(this.selectedSite))
    this.abundanceTable.on('rowClick', (_event, row) => {
      this.selectSite((row.getData() as DetailRow).site)
      this.showMain('protein')
      this.showDetailView('structure')
    })
    this.abundanceTable.on('tableBuilt', () => this.syncSelectedAbundanceRow())
  }

  private syncSelectedAbundanceRow(): void {
    if (!this.abundanceTable || !this.selectedSite) return
    this.abundanceTable.deselectRow()
    if (this.abundanceTable.getRow(this.selectedSite)) this.abundanceTable.selectRow(this.selectedSite)
  }

  private async refreshAbundance(): Promise<void> {
    const ready = Boolean(this.detail && this.selectedSite && this.data)
    this.el('#abundance-content').hidden = !ready
    this.el('#abundance-empty').hidden = ready
    this.el('#abundance-empty').textContent = this.detail
      ? 'No sites match the current filters.' : 'Choose a protein and site first.'
    if (!ready || this.mainView !== 'abundance') return
    this.el('#abundance-context').textContent = this.detail!.protein.gene_name || this.detail!.protein.protein_Id
    this.refreshAbundanceTable(this.visibleDetailRows())
    await this.renderAbundance(this.selectedSite)
  }

  private async renderAbundance(site: string | null): Promise<void> {
    if (!this.detail || !this.data || !site || this.mainView !== 'abundance') return
    try {
      const figure = buildAbundanceFigure(this.detail.evidence, this.data.run.method, site, this.displayedContrast)
      const plot = this.el<HTMLDivElement>('#abundance-plot')
      figure.layout.height = plot.clientHeight
      await renderFigure(plot, figure)
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), true)
    }
  }
}

customElements.define('ptm-browser-app', PtmBrowserApp)
