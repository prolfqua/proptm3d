import { replaceTableRows } from './table-data.js'
import { html, LitElement } from 'lit'
import { TabulatorFull } from 'tabulator-tables'
import { renderApp, type AppViewActions, type DetailView, type FindView, type MainView } from './app-view.js'
import { createFindTable, createSiteTable, type FindRow } from './app-tables.js'
import { buildAbundanceFigure, buildNtoCFigure, buildProteinSiteFigure, buildVolcanoFigure, focusProteinTraces, plotSelectionNote, renderFigure, type FigureSpec, type ProteinTraceUpdate } from './charts.js'
import { loadAppData, loadProteinDetail } from './data.js'
import { buildDetailRows, displayProteinDescription, type DetailRow, type EstimateType } from './detail.js'
import { FilterPanel } from './filter-panel.js'
import { chooseDisplayedContrast, FilterModel, NO_ENRICHMENT } from './filtering.js'
import { profileFor, type BrowserProfile } from './browser-profile.js'
import type { GseaController } from './gsea-controller.js'
import { computeLogos } from './logo.js'
import { renderLogo } from './logo-view.js'
import { buildPaeFigure, loadPae, paeBlockSize, paeModelFor, renderPae } from './pae.js'
import { loadPlotBackgrounds, type PlotBackgrounds } from './plot-backgrounds.js'
import { ALL_STRUCTURES, structureLabel, type ExposureFilter, type RegionFilter, type StructuralFilters } from './structural.js'
import { summarizeProteins, validCutoffs } from './summary.js'
import type { AppData, ProteinCatalogRow, ProteinDetail, Thresholds } from './types.js'
import { rowsForSites } from './upset-model.js'
import type { SiteMarker, StructureViewer } from './structure.js'
import type { StructureColoring } from './structure-colors.js'

function residueLabel(row: Pick<DetailRow, 'site' | 'modAA' | 'posInProtein'>): string {
  return row.modAA && row.posInProtein !== null ? `${row.modAA}${row.posInProtein}` : row.site
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
  private readonly filterModel = new FilterModel()
  private profile: BrowserProfile | null = null
  private filters!: FilterPanel
  private gsea: GseaController | null = null
  private findScopeProteinCount = 0
  private focusPlotsPending = false
  private focusPlotsInProgress = false
  private focusPlotsIdle: Promise<void> = Promise.resolve()
  private resolveFocusPlotsIdle: (() => void) | null = null
  private readonly viewActions: AppViewActions = {
    toggleGuide: (open) => this.toggleGuide(open),
    changeThresholds: () => this.changeThresholds(),
    changeDisplayedContrast: (event) => this.changeDisplayedContrast(event),
    changeEstimateType: (event) => this.changeEstimateType(event),
    changeStructuralFilters: () => this.changeStructuralFilters(),
    refreshSummary: () => this.refreshSummary(),
    showMain: (view) => this.showMain(view),
    showFind: (view) => this.showFind(view),
    showDetailView: (view) => this.showDetailView(view),
    changeStructureStyle: () => this.changeStructureStyle(),
    changeGseaResult: (event) => this.gsea?.changeResult(event),
    changeSequenceSet: (event) => this.gsea?.changeSequenceSet(event),
    changeGseaFdr: () => this.gsea?.changeFdr(),
    searchSequenceSets: () => this.gsea?.searchSequenceSets(),
    changeLeadingEdge: () => this.gsea?.changeLeadingEdge(),
  }

  protected createRenderRoot(): HTMLElement { return this }

  protected render() { return this.profile ? renderApp(this.viewActions,this.profile)
    : html`<header class="masthead"><div class="brand"><h1>proptm3d</h1></div><div id="app-status" class="status" role="status">Loading prepared data…</div></header>` }

  protected firstUpdated(): void {
    void this.start()
  }

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
    this.gsea?.dispose()
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
      this.profile = profileFor(data.run)
      this.requestUpdate()
      await this.updateComplete
      this.filters = new FilterPanel(this, this.filterModel, () => this.refreshScopedViews(),
        message => this.setStatus(message, true), this.profile)
      this.gsea = await this.profile.enrichment?.createController(
        this,
        () => this.refreshScopedViews(),
        matches => this.filters.findSequenceSets(matches),
        (message, error) => this.setStatus(message, error),
        (proteinId, site, contrast) => {
          const protein = this.data?.proteins.find((row) => row.protein_Id === proteinId)
          if (protein) void this.openProtein(protein, site, contrast)
        },
      ) ?? null
      this.displayedContrast = this.data.run.contrasts[0] ?? ''
      this.el('#method-pill').textContent = this.data.run.method
      this.el('#run-counts').textContent = `${this.data.run.counts.proteins.toLocaleString()} proteins · ${this.data.run.counts.measured_sites.toLocaleString()} measured sites`
      this.syncDisplayedContrasts()
      this.refreshSummary()
      await this.gsea?.configure(this.data, this.displayedContrast, this.filterModel.bContrasts)
      this.setStatus('Ready · local prepared data')
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), true)
    }
  }

  private syncDisplayedContrasts(): boolean {
    const contrasts = this.filterModel.get('a').sets.length
      ? this.filterModel.bContrasts : this.data?.run.contrasts ?? []
    const select = this.el<HTMLSelectElement>('#displayed-contrast')
    const currentOptions=[...select.options].map(option=>option.value)
    if (currentOptions.length!==contrasts.length
      || currentOptions.some((contrast,index)=>contrast!==contrasts[index])) {
      select.replaceChildren(...contrasts.map(contrast=>new Option(contrast,contrast)))
    }
    const previous = this.displayedContrast
    this.displayedContrast = chooseDisplayedContrast(contrasts,this.displayedContrast)
    select.value = this.displayedContrast
    return previous !== this.displayedContrast
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
    this.gsea?.setVisible(view === 'find' && this.findView === 'gsea')
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
    if (this.gsea) this.el('#gsea-workspace').hidden = view !== 'gsea'
    this.el('#find-grid').hidden = view === 'sequlogos' || view === 'gsea'
    this.el('#focused-plots').hidden = view !== 'single'
    this.el('#find-plots').hidden = view !== 'sequlogos'
    this.gsea?.setVisible(this.mainView === 'find' && view === 'gsea')
    this.el('#find-row-hint').textContent = view === 'single'
      ? 'Hover a row to isolate its plotted sites · click for details'
      : view === 'gsea'
        ? 'Apply a sequence set, then click a protein to inspect its sites'
      : 'Click a row to inspect its sites'
    this.el('#find-grid').classList.toggle('all-contrasts', view === 'all' || view === 'gsea')
    if (view !== 'sequlogos') this.refreshSummary()
    if (view !== 'all') {
      const resizePlots = this.renderedFindPlotKey !== null || this.findPlotInProgress
      this.requestFindPlots()
      if (resizePlots) void this.resizeFindPlots()
    }
  }

  private changeDisplayedContrast(event: Event): void {
    this.displayedContrast = (event.target as HTMLSelectElement).value
    this.gsea?.restrictContrasts(this.filterModel.bContrasts,this.displayedContrast)
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

  private refreshScopedViews(): void {
    if (!this.data) return
    this.syncDisplayedContrasts()
    this.gsea?.restrictContrasts(this.filterModel.bContrasts,this.displayedContrast)
    this.refreshSummary()
    this.requestFindPlots(true)
    if (this.detail) void this.refreshDetail()
  }

  private refreshSummary(): void {
    if (!this.data) return
    this.filters.update(this.data, this.displayedContrast, this.thresholds, this.estimateType, this.structural,
      this.gsea?.enrichment ?? NO_ENRICHMENT)
    this.gsea?.setBranchSelection(this.filterModel.state.b)
    const selected = this.filterModel.siteKeys
    const sites = rowsForSites(this.data.sites, selected)
    const results = rowsForSites(this.data.siteIndex, selected)
    const byProtein = new Map<string, typeof sites>()
    for (const site of sites) {
      const group = byProtein.get(site.protein_Id) ?? []
      group.push(site)
      byProtein.set(site.protein_Id, group)
    }
    const proteins = this.data.proteins.filter(p => byProtein.has(p.protein_Id))
    const contrast = this.findView === 'all' ? null : this.displayedContrast
    const summaries: FindRow[] = summarizeProteins(proteins, results, contrast, this.thresholds).map(summary => {
      const matching = byProtein.get(summary.protein_Id)!
      return {...summary, measured_sites:matching.length, matching_sites:matching.map(s=>s.site),
        matching_site_labels:matching.map(s=>s.modAA && s.posInProtein!==null ? s.modAA+s.posInProtein : s.site)}
    })
    const search = this.el<HTMLInputElement>('#find-search').value.trim().toLocaleLowerCase()
    this.gsea?.setSelection(selected, search)
    const matching = search ? summaries.filter(row => [row.gene_name,row.accession,row.protein_Id]
      .some(value => value?.toLocaleLowerCase().includes(search))) : summaries
    this.findScopeProteinCount = summaries.length
    this.el('#find-count').textContent = `${matching.length.toLocaleString()} / ${summaries.length.toLocaleString()} proteins`
    if (!this.findTable) this.createFindTable(matching)
    else void replaceTableRows(this.findTable,matching)
  }

  private findPlotKey(): string {
    return [this.findView,this.displayedContrast,this.filterModel.revision].join('\u0000')
  }

  private visiblePlotSites() {
    return rowsForSites(this.data!.siteIndex,this.filterModel.siteKeys)
  }

  private requestFindPlots(debounce = false): void {
    if (this.findPlotFrame !== null) window.cancelAnimationFrame(this.findPlotFrame)
    this.findPlotFrame = null
    if (this.findPlotTimer !== null) window.clearTimeout(this.findPlotTimer)
    this.findPlotTimer = null
    if (!this.data || !['single', 'sequlogos'].includes(this.findView) || this.mainView !== 'find') return
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
      if (!['single', 'sequlogos'].includes(this.findView)
        || this.mainView !== 'find' || this.findPlotInProgress) return
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

  private createFindTable(rows: FindRow[]): void {
    this.findTable = createFindTable(this.el('#find-table'), rows, {
      open: (protein) => {
        void this.openProtein(protein, protein.matching_sites[0] ?? null)
      },
      hover: (proteinId) => {
        if (this.findView === 'single' && this.mainView === 'find') this.setHoveredProtein(proteinId)
      },
      count: (visible) => {
        this.el('#find-count').textContent = `${visible.toLocaleString()} / ${this.findScopeProteinCount.toLocaleString()} proteins`
      },
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
        if (view === 'all' || view === 'gsea') break
        const key = this.findPlotKey()
        if (this.renderedFindPlotKey === key || this.findPlotTimer !== null) break
        const siteIndex = this.visiblePlotSites()
        const selectedCount = this.filterModel.siteKeys.size
        const highlightIntersection = true
        const contrast = this.displayedContrast
        const thresholds = this.thresholds
        const backgrounds = this.plotBackgrounds?.plots[contrast]
        if (!backgrounds) throw new Error(`Precomputed plot backgrounds are missing for ${contrast}.`)
        const volcano = buildVolcanoFigure(
          siteIndex, contrast, thresholds.fdr, thresholds.absEffect,
          backgrounds.volcano, highlightIntersection,
        )
        const scatter = buildProteinSiteFigure(siteIndex, contrast, thresholds.fdr, thresholds.absEffect,
          backgrounds.protein_site, highlightIntersection)
        await this.focusPlotsIdle
        if (this.mainView !== 'find') break
        if (key !== this.findPlotKey()) continue
        const prefix = view === 'single' ? 'focus-' : ''
        this.el(`#${prefix}volcano-note`).textContent = plotSelectionNote(volcano,selectedCount,contrast)
        this.el(`#${prefix}protein-site-note`).textContent = plotSelectionNote(scatter.figure,selectedCount,contrast)
        this.focusedFigures = null
        this.renderedFindPlotKey = null
        const onClick = (point: { proteinId: string; site: string; contrast: string }) => {
          const protein = this.data?.proteins.find((row) => row.protein_Id === point.proteinId)
          if (protein) void this.openProtein(protein, point.site, point.contrast)
        }
        if (view === 'single') {
          const focusBase = structuredClone({ volcano, proteinSite: scatter.figure })
          const renders = await Promise.allSettled([
            renderFigure(this.el<HTMLDivElement>('#focus-volcano-plot'), volcano, onClick, 'gl2d'),
            renderFigure(this.el<HTMLDivElement>('#focus-protein-site-plot'), scatter.figure, onClick, 'gl2d'),
          ])
          const failed = renders.find((result) => result.status === 'rejected')
          if (failed?.status === 'rejected') throw failed.reason
          this.focusedFigures = focusBase
        } else {
          const logos = computeLogos(siteIndex, contrast)
          this.el('#up-count').textContent = `${logos.upCount.toLocaleString()} sites`
          this.el('#down-count').textContent = `${logos.downCount.toLocaleString()} sites`
          const noDirection = selectedCount - logos.upCount - logos.downCount - logos.invalidWindowCount
          this.el('#logo-note').textContent = [
            '15-residue windows centered on the modified amino acid.',
            noDirection > 0 ? `${noDirection.toLocaleString()} selected sites have no nonzero effect in ${contrast}; no Up/Down assignment.` : '',
            logos.invalidWindowCount > 0 ? `${logos.invalidWindowCount.toLocaleString()} selected sites lack a valid centered sequence window.` : '',
          ].filter(Boolean).join(' ')
          renderLogo(this.el('#up-logo'), logos.up, false, 'No selected sites with positive effects and valid windows.')
          renderLogo(this.el('#down-logo'), logos.down, false, 'No selected sites with negative effects and valid windows.')
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
      if (contrast) {
        this.displayedContrast = contrast
      }
      this.el<HTMLSelectElement>('#displayed-contrast').value = this.displayedContrast
      this.refreshSummary()
      this.selectedSite = site
      this.el('#protein-empty').hidden = true
      this.el('#protein-content').hidden = false
      this.el('#protein-info').textContent = `${protein.accession} · ${protein.protein_Id} · ${detail.sites.length} measured sites · ${detail.structures.length} structures · annotation ${detail.features.status}`
      this.showDetailView('structure')
      await this.refreshDetail(true)
    } catch (error) {
      if (id !== this.detailLoadId) return
      this.detail = null
      this.selectedSite = null
      this.el('#protein-content').hidden = true
      this.el('#protein-empty').hidden = false
      this.el('#protein-empty').textContent = error instanceof Error ? error.message : String(error)
      this.setStatus(this.el('#protein-empty').textContent, true)
    }
  }

  private visibleDetailRows(): DetailRow[] {
    if (!this.detail) return []
    return rowsForSites(buildDetailRows(this.detail, this.displayedContrast, this.thresholds), this.filterModel.siteKeys)
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
      await replaceTableRows(this.detailTable,rows)
      this.syncSelectedTableRow()
      return
    }
    this.detailTable = createSiteTable(this.el('#detail-table'), rows, 'row_id', {
      click: (site) => this.selectSite(site),
      built: () => this.syncSelectedTableRow(),
    })
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
        new Set(rows.map((row) => row.site)), this.detail.residueContext)
      const plot = this.el<HTMLDivElement>('#ntoc-plot')
      plot.style.minHeight = `${figure.layout.height}px`
      figure.layout.height = Math.max(plot.clientHeight, figure.layout.height as number)
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
      void replaceTableRows(this.abundanceTable,rows).then(() => this.syncSelectedAbundanceRow())
      return
    }
    this.abundanceTable = createSiteTable(this.el('#abundance-table'), rows, 'site', {
      enter: (site) => void this.renderAbundance(site),
      leave: () => void this.renderAbundance(this.selectedSite),
      click: (site) => {
        this.selectSite(site)
        this.showMain('protein')
        this.showDetailView('structure')
      },
      built: () => this.syncSelectedAbundanceRow(),
    })
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
