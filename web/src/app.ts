import { LitElement } from 'lit'
import { TabulatorFull } from 'tabulator-tables'
import { renderApp, type AppViewActions, type DetailView, type FindView, type MainView } from './app-view.js'
import { createFindTable, createSiteTable, type FindRow } from './app-tables.js'
import { buildAbundanceFigure, buildNtoCFigure, buildProteinSiteFigure, buildVolcanoFigure, focusProteinTraces, plotThresholds, proteinBackgroundPoints, renderFigure, type FigureSpec, type ProteinTraceUpdate } from './charts.js'
import { loadAppData, loadProteinDetail } from './data.js'
import { buildDetailRows, displayProteinDescription, selectDetailRows, type DetailRow, type EstimateType } from './detail.js'
import { GseaController } from './gsea-controller.js'
import { computeLogos } from './logo.js'
import { renderLogo } from './logo-view.js'
import { buildPaeFigure, loadPae, paeBlockSize, paeModelFor, renderPae } from './pae.js'
import { loadPlotBackgrounds, type PlotBackgrounds } from './plot-backgrounds.js'
import { ALL_STRUCTURES, isStructurallyFiltered, passesStructuralFilters, structureLabel, type ExposureFilter, type RegionFilter, type StructuralFilters } from './structural.js'
import { summarizeProteins, validCutoffs } from './summary.js'
import type { AppData, ProteinCatalogRow, ProteinDetail, Thresholds } from './types.js'
import {
  buildUpSetFigure, computeUpSet, contrastsForIntersection, renderUpSet, rowsForIntersection,
  type UpSetIntersection, type UpSetModel,
} from './upset.js'
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
  private selectedIntersection: string | null = null
  private intersectionFilterEnabled = false
  private upSetModel: UpSetModel | null = null
  private upSetModelKey: string | null = null
  private renderedUpSetKey: string | null = null
  private upSetRenderId = 0
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
    changeShowAllSites: () => this.changeShowAllSites(),
    showDetailView: (view) => this.showDetailView(view),
    changeStructureStyle: () => this.changeStructureStyle(),
    changeGseaResult: (event) => this.gsea?.changeResult(event),
    changeGseaFdr: () => this.gsea?.changeFdr(),
    searchSequenceSets: () => this.gsea?.searchSequenceSets(),
    changeSequenceSet: (event) => this.gsea?.changeSequenceSet(event),
    changeLeadingEdge: () => this.gsea?.changeLeadingEdge(),
    toggleGseaFilter: () => this.gsea?.toggleFilter(),
  }

  protected createRenderRoot(): HTMLElement { return this }

  protected render() { return renderApp(this.viewActions) }

  protected firstUpdated(): void {
    this.gsea = new GseaController(
      this,
      () => this.refreshScopedViews(),
      (message, error) => this.setStatus(message, error),
      (proteinId, site, contrast) => {
        const protein = this.data?.proteins.find((row) => row.protein_Id === proteinId)
        if (protein) void this.openProtein(protein, site, contrast)
      },
    )
    this.el<HTMLButtonElement>('#upset-filter-enabled').addEventListener(
      'click',
      () => this.changeIntersectionFilter(),
    )
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
      this.displayedContrast = this.data.run.contrasts[0] ?? ''
      this.el('#method-pill').textContent = this.data.run.method
      this.el('#run-counts').textContent = `${this.data.run.counts.proteins.toLocaleString()} proteins · ${this.data.run.counts.measured_sites.toLocaleString()} measured sites`
      this.syncDisplayedContrasts(null)
      this.refreshSummary()
      await this.gsea?.configure(this.data.run, this.displayedContrast, this.data.proteins)
      this.setStatus('Ready · local prepared data')
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), true)
    }
  }

  private syncDisplayedContrasts(intersection: UpSetIntersection | null): boolean {
    const contrasts = contrastsForIntersection(this.data?.run.contrasts ?? [], intersection)
    const select = this.el<HTMLSelectElement>('#displayed-contrast')
    const currentOptions = [...select.options].map((option) => option.value)
    if (currentOptions.length !== contrasts.length
      || currentOptions.some((contrast, index) => contrast !== contrasts[index])) {
      select.replaceChildren()
      for (const contrast of contrasts) select.add(new Option(contrast, contrast))
    }
    const previous = this.displayedContrast
    if (!contrasts.includes(this.displayedContrast)) this.displayedContrast = contrasts[0] ?? ''
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
    this.gsea?.setVisible(this.mainView === 'find' && view === 'gsea')
    this.el('#gsea-workspace').hidden = view !== 'gsea'
    this.el('#find-grid').hidden = view === 'sequlogos' || view === 'gsea'
    this.el('#upset-card').hidden = view !== 'all'
    this.el('#focused-plots').hidden = view !== 'single'
    this.el('#find-plots').hidden = view !== 'sequlogos'
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
    void this.gsea?.setContrast(this.displayedContrast)
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

  private changeIntersectionFilter(): void {
    this.intersectionFilterEnabled = !this.intersectionFilterEnabled
    this.renderedUpSetKey = null
    this.refreshSummary()
    this.requestFindPlots(true)
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
    this.refreshSummary()
    this.requestFindPlots(true)
    if (this.detail) void this.refreshDetail()
  }

  /** The site set shared by every Find view: estimate type and structural filters, never significance. */
  private visibleSiteIndex() {
    const index = this.data!.siteIndex
    const filtered = this.estimateType === 'all' && !isStructurallyFiltered(this.structural)
      ? index
      : index.filter((row) => (this.estimateType === 'all'
        || row.site_estimate_type === this.estimateType)
        && passesStructuralFilters(row.structure, this.structural))
    return this.gsea?.filterSites(filtered) ?? filtered
  }

  private refreshSummary(): void {
    if (!this.data) return
    this.setHoveredProtein(null)
    const visibleSites = this.visibleSiteIndex()
    let proteins = this.data.proteins
    let summarySites = visibleSites
    if (this.gsea?.isFiltering) {
      const proteinIds = new Set(summarySites.map((row) => row.protein_Id))
      proteins = proteins.filter((protein) => proteinIds.has(protein.protein_Id))
    }
    const model = this.currentUpSetModel(visibleSites)
    const selection = model.intersections.find(
      (candidate) => candidate.key === this.selectedIntersection,
    ) ?? null
    if (this.selectedIntersection !== null && !selection) {
      this.selectedIntersection = null
      this.intersectionFilterEnabled = false
    }
    const activeIntersection = this.intersectionFilterEnabled ? selection : null
    if (this.syncDisplayedContrasts(activeIntersection)) {
      void this.gsea?.setContrast(this.displayedContrast)
    }
    const contrast = this.findView === 'all' ? null : this.displayedContrast
    if (activeIntersection) {
      summarySites = rowsForIntersection(visibleSites, activeIntersection)
      proteins = proteins.filter((protein) => activeIntersection.sitesByProtein.has(protein.protein_Id))
    }
    if (this.findView === 'all') {
      void this.refreshUpSet(model, selection)
    } else {
      this.syncUpSetControl(selection)
    }
    const siteLabels = new Map(summarySites.map((row) => [
      `${row.protein_Id}\u0000${row.site}`,
      row.modAA && row.posInProtein !== null ? `${row.modAA}${row.posInProtein}` : row.site.split('~', 1)[0],
    ]))
    const summaries: FindRow[] = summarizeProteins(proteins, summarySites, contrast, this.thresholds)
      .map((summary) => {
        const matchingSites = activeIntersection
          ? [...(activeIntersection.sitesByProtein.get(summary.protein_Id) ?? [])]
          : []
        return {
          ...summary,
          measured_sites: activeIntersection ? matchingSites.length : summary.measured_sites,
          matching_sites: matchingSites,
          matching_site_labels: matchingSites.map((site) =>
            siteLabels.get(`${summary.protein_Id}\u0000${site}`) ?? site.split('~', 1)[0]),
        }
      })
    const search = this.el<HTMLInputElement>('#find-search').value.trim().toLocaleLowerCase()
    this.gsea?.setSiteSearch(search)
    const matching = search ? summaries.filter((row) => [row.gene_name, row.accession, row.protein_Id]
      .some((value) => value?.toLocaleLowerCase().includes(search))) : summaries
    this.findScopeProteinCount = summaries.length
    this.el('#find-count').textContent = `${matching.length.toLocaleString()} / ${summaries.length.toLocaleString()} proteins`
    if (!this.findTable) this.createFindTable(matching)
    else void this.findTable.replaceData(matching)
    if (activeIntersection) this.findTable!.showColumn('matching_site_labels')
    else this.findTable!.hideColumn('matching_site_labels')
  }

  private upSetFilterKey(): string {
    return [this.estimateType, this.thresholds.fdr, this.thresholds.absEffect,
      this.structural.exposure, this.structural.region, this.gsea?.filterKey ?? ''].join('\u0000')
  }

  private currentUpSetModel(rows: readonly AppData['siteIndex'][number][]): UpSetModel {
    const key = this.upSetFilterKey()
    if (!this.upSetModel || this.upSetModelKey !== key) {
      this.upSetModel = computeUpSet(rows, this.data!.run.contrasts, this.thresholds)
      this.upSetModelKey = key
      this.renderedUpSetKey = null
    }
    return this.upSetModel
  }

  private async refreshUpSet(model: UpSetModel, selection: UpSetIntersection | null): Promise<void> {
    const renderKey = [this.upSetModelKey ?? '', selection?.key ?? '', this.intersectionFilterEnabled].join('\u0000')
    this.syncUpSetControl(selection)
    this.el('#upset-summary').textContent = selection
      ? `${selection.siteCount.toLocaleString()} sites in ${selection.proteinCount.toLocaleString()} proteins`
        + (this.intersectionFilterEnabled ? '' : ' · filter paused')
      : `${model.intersections.length.toLocaleString()} nonempty exact intersections`
    this.el('#upset-note').textContent = selection
      ? this.intersectionFilterEnabled
        ? `${selection.contrasts.join(' ∩ ')} · every workspace uses only sites in this exact intersection.`
        : `${selection.contrasts.join(' ∩ ')} · selection paused; use the UpSet selection toggle above`
          + ' to restore it.'
      : model.intersections.length > 0
        ? 'Click an intersection bar or matrix dot to filter the protein table.'
        : 'No sites pass the active statistical, estimate, and structural filters.'
    if (this.renderedUpSetKey === renderKey) return
    const id = ++this.upSetRenderId
    try {
      await renderUpSet(
        this.el<HTMLDivElement>('#upset-plot'),
        buildUpSetFigure(model, selection?.key ?? null),
        (key) => this.selectIntersection(key),
      )
      if (id === this.upSetRenderId) this.renderedUpSetKey = renderKey
    } catch (error) {
      if (id === this.upSetRenderId) this.setStatus(error instanceof Error ? error.message : String(error), true)
    }
  }

  private syncUpSetControl(selection: UpSetIntersection | null): void {
    const control = this.el<HTMLDivElement>('#upset-filter-control')
    const enabled = this.el<HTMLButtonElement>('#upset-filter-enabled')
    control.hidden = selection === null
    enabled.classList.toggle('is-active', selection !== null && this.intersectionFilterEnabled)
    this.el('#upset-filter-state').textContent = this.intersectionFilterEnabled ? 'On' : 'Off'
    this.el('#upset-filter-label').textContent = selection
      ? `${selection.siteCount.toLocaleString()} sites in ${selection.proteinCount.toLocaleString()} proteins`
      : 'Apply selected sites'
    control.title = selection?.contrasts.join(' ∩ ') ?? ''
  }

  private selectIntersection(key: string | null): void {
    if (key === null) {
      this.selectedIntersection = null
      this.intersectionFilterEnabled = false
    } else if (key === this.selectedIntersection) {
      this.intersectionFilterEnabled = !this.intersectionFilterEnabled
    } else {
      this.selectedIntersection = key
      this.intersectionFilterEnabled = true
    }
    this.renderedUpSetKey = null
    this.refreshSummary()
    this.requestFindPlots(true)
    if (this.detail) void this.refreshDetail()
  }

  private activeIntersection(): UpSetIntersection | null {
    if (!this.intersectionFilterEnabled) return null
    return this.upSetModel?.intersections.find(
      (candidate) => candidate.key === this.selectedIntersection,
    ) ?? null
  }

  private findPlotKey(): string {
    return [this.findView, this.displayedContrast, this.estimateType, this.thresholds.fdr,
      this.thresholds.absEffect, this.structural.exposure, this.structural.region,
      this.intersectionFilterEnabled ? this.selectedIntersection ?? '' : '',
      this.gsea?.filterKey ?? ''].join('\u0000')
  }

  private visiblePlotSites() {
    const rows = this.visibleSiteIndex()
    const intersection = this.activeIntersection()
    return intersection ? rowsForIntersection(rows, intersection) : rows
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
        const intersection = this.activeIntersection()
        void this.openProtein(protein, protein.matching_sites[0] ?? null, intersection?.contrasts[0])
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
        if (proteinId !== null) {
          const rows = this.visiblePlotSites()
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
        if (view === 'all' || view === 'gsea') break
        const key = this.findPlotKey()
        if (this.renderedFindPlotKey === key || this.findPlotTimer !== null) break
        const siteIndex = this.visiblePlotSites()
        const highlightIntersection = this.activeIntersection() !== null
        const contrast = this.displayedContrast
        const thresholds = plotThresholds(this.thresholds)
        const backgrounds = this.plotBackgrounds?.plots[contrast]
        if (!backgrounds) throw new Error(`Precomputed plot backgrounds are missing for ${contrast}.`)
        const volcano = buildVolcanoFigure(
          siteIndex, contrast, thresholds.fdr, thresholds.absEffect,
          backgrounds.volcano, highlightIntersection,
        )
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
            backgrounds.protein_site, highlightIntersection)
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
            backgrounds.protein_site, highlightIntersection)
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
      if (contrast) {
        this.displayedContrast = contrast
        void this.gsea?.setContrast(contrast)
      }
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
    const rows = selectDetailRows(this.detail, this.displayedContrast, this.thresholds,
      this.estimateType, this.showAllSites, this.structural)
    const intersection = this.activeIntersection()
    const intersected = intersection ? rowsForIntersection(rows, intersection) : rows
    return this.gsea?.filterSites(intersected) ?? intersected
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
      void this.abundanceTable.replaceData(rows).then(() => this.syncSelectedAbundanceRow())
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
