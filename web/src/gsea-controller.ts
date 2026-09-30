import { replaceTableRows } from './table-data.js'
import type { TabulatorFull } from 'tabulator-tables'

import { renderFigure } from './charts.js'
import { loadGseaPayload } from './data.js'
import {
  buildEnrichmentFigure,
  gseaSiteTableRows,
  type GseaSiteTableRow,
  buildGseaVolcanoFigure,
  selectedSequenceSet,
  sequenceSetKey,
  sequenceSetsAtFdr,
} from './gsea.js'
import {
  createGseaSiteTable,
  createGseaTable,
  gseaTableRows,
} from './gsea-table.js'
import { sequenceSets } from './filtering.js'
import type { EnrichmentSets } from './filter-panel.js'
import type { AppData, GseaPayload, RunManifest } from './types.js'

type Status = (message: string, error?: boolean) => void

export class GseaController {
  private run: RunManifest | null = null
  private payload: GseaPayload | null = null
  private resultId = ''
  private contrast = ''
  private selectedKey = ''
  private fdr = 0.05
  private sequenceSearch = ''
  private leadingEdgeOnly = false
  private loadId = 0
  private visible = false
  private rendering = false
  private renderPending = false
  private table: TabulatorFull | null = null
  private siteTable: TabulatorFull | null = null
  private siteRows: GseaSiteTableRow[] = []
  private data: AppData | null = null
  private selectedSites: ReadonlySet<string> = new Set()
  enrichment: EnrichmentSets = {sets:[],context:'',revision:0,status:'Loading enrichment…',ready:false}
  private proteinSearch = ''

  constructor(
    private readonly root: HTMLElement,
    private readonly scopeChanged: () => void,
    private readonly findSets: (matches: ReadonlySet<string> | null) => void,
    private readonly setStatus: Status,
    private readonly openSite: (proteinId: string, site: string, contrast: string) => void,
  ) {}

  private el<T extends HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector)
    if (!element) throw new Error(`Missing GSEA view element ${selector}`)
    return element
  }

  async configure(
    data: AppData,
    contrast: string,
  ): Promise<void> {
    this.data = data
    const run = data.run
    if (!run.gsea?.results.length) return
    this.run = run
    this.contrast = contrast
    const select = this.el<HTMLSelectElement>('#gsea-result')
    select.replaceChildren(...run.gsea.results.map((result) => new Option(result.label, result.id)))
    this.resultId = run.gsea.results[0].id
    select.value = this.resultId
    this.el('#gsea-controls').hidden = false
    this.el('#gsea-find-tab').hidden = false
    await this.load()
  }

  dispose(): void {
    this.table?.destroy()
    this.siteTable?.destroy()
  }

  private publishSets(status = 'Ready', ready = this.payload !== null): void {
    this.enrichment = {sets:this.payload?sequenceSets(this.payload,this.fdr,this.leadingEdgeOnly):[],
      context:`${this.resultId}\u0000${this.contrast}`, revision:this.enrichment.revision+1, status, ready}
    this.scopeChanged()
  }

  async setContrast(contrast: string): Promise<void> {
    if (!this.run || contrast === this.contrast) return
    this.contrast = contrast
    await this.load()
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    if (visible) {
      this.refreshTable()
      this.refreshSiteTable()
      void this.renderPlots()
    }
  }

  setSelection(keys: ReadonlySet<string>, search: string): void {
    if (this.selectedSites === keys && this.proteinSearch === search) return
    this.selectedSites = keys
    this.proteinSearch = search
    this.refreshSiteTable()
    if (this.visible) void this.renderPlots()
  }

  changeResult(event: Event): void {
    this.resultId = (event.target as HTMLSelectElement).value
    void this.load()
  }

  changeFdr(): void {
    const value = Number(this.el<HTMLInputElement>('#gsea-fdr').value)
    if (!Number.isFinite(value) || value <= 0 || value > 1) {
      this.setStatus('Use a GSEA FDR in (0, 1].', true)
      return
    }
    this.fdr = value
    this.syncSequenceSet()
    this.refreshTable()
    this.refreshSiteTable()
    void this.renderPlots()
    this.publishSets()
  }

  searchSequenceSets(): void {
    this.sequenceSearch = this.el<HTMLInputElement>('#sequence-set-search').value
      .trim().toLocaleLowerCase()
    if (this.syncSequenceSetOptions(undefined,true)) {
      this.syncSelectedRow()
      this.refreshSiteTable()
      void this.renderPlots()
    }
  }

  changeSequenceSet(event: Event): void {
    this.selectSequenceSet((event.target as HTMLSelectElement).value)
  }

  changeLeadingEdge(): void {
    this.leadingEdgeOnly = this.el<HTMLInputElement>('#leading-edge-only').checked
    this.refreshSiteTable()
    this.publishSets()
  }

  private async load(): Promise<void> {
    if (!this.run) return
    const id = ++this.loadId
    this.payload = null
    this.syncSequenceSetOptions([])
    this.refreshTable()
    this.publishSets('Loading enrichment…', false)
    this.setStatus(`Loading ${this.resultId} for ${this.contrast}…`)
    try {
      const payload = await loadGseaPayload(this.run, this.resultId, this.contrast)
      if (id !== this.loadId) return
      this.payload = payload
      this.syncSequenceSet()
      this.refreshTable()
      this.refreshSiteTable()
      this.publishSets(payload ? 'Ready' : 'No enrichment result for this contrast.', payload !== null)
      this.setStatus(payload ? 'Ready · local prepared GSEA data' : 'No GSEA result for this contrast.')
    } catch (error) {
      if (id !== this.loadId) return
      this.payload = null
      this.selectedKey = ''
      this.syncSequenceSetOptions([])
      this.refreshTable()
      this.refreshSiteTable()
      this.publishSets(error instanceof Error ? error.message : String(error), false)
      this.setStatus(error instanceof Error ? error.message : String(error), true)
    }
  }

  private syncSequenceSet(): boolean {
    const previous = this.selectedKey
    const options = this.payload ? sequenceSetsAtFdr(this.payload, this.fdr) : []
    if (!options.some((row) => sequenceSetKey(row.source, row.sequence_set) === previous)) {
      this.selectedKey = options.length
        ? sequenceSetKey(options[0].source, options[0].sequence_set)
        : ''
    }
    this.syncSequenceSetOptions(options,true)
    return previous !== this.selectedKey
  }

  private syncSequenceSetOptions(
    available = this.payload ? sequenceSetsAtFdr(this.payload, this.fdr) : [],
    focusMatch = false,
  ): boolean {
    const previous=this.selectedKey
    const matching = this.sequenceSearch
      ? available.filter((row) => [row.sequence_set, row.description, row.source]
        .some((value) => value.toLocaleLowerCase().includes(this.sequenceSearch)))
      : available
    const matchingKeys=new Set(matching.map(row=>sequenceSetKey(row.source,row.sequence_set)))
    this.findSets(this.sequenceSearch?matchingKeys:null)
    if (focusMatch && this.sequenceSearch && matching.length && !matchingKeys.has(this.selectedKey)) {
      this.selectedKey=sequenceSetKey(matching[0].source,matching[0].sequence_set)
    }
    const selected = available.find(
      (row) => sequenceSetKey(row.source, row.sequence_set) === this.selectedKey,
    )
    const options = selected && !matching.includes(selected) ? [selected, ...matching] : matching
    const select = this.el<HTMLSelectElement>('#sequence-set')
    select.replaceChildren(...options.map((row) => new Option(
      `${row.sequence_set} · ${row.source}`,
      sequenceSetKey(row.source, row.sequence_set),
    )))
    select.value = this.selectedKey
    return previous!==this.selectedKey
  }

  selectSequenceSet(key: string): void {
    if (!this.payload || !selectedSequenceSet(this.payload, key)) return
    this.selectedKey = key
    this.syncSequenceSetOptions()
    this.syncSelectedRow()
    this.refreshSiteTable()
    void this.renderPlots()
  }

  private refreshTable(): void {
    if (!this.visible) return
    const sequenceSets = this.payload ? sequenceSetsAtFdr(this.payload, this.fdr) : []
    const rows = gseaTableRows(sequenceSets)
    const count = this.payload?.sequenceSets.length ?? 0
    this.el('#gsea-result-count').textContent = `${rows.length.toLocaleString()} / ${count.toLocaleString()} below FDR`
    if (!this.table) {
      this.table = createGseaTable(
        this.el('#gsea-table'), rows, (key) => this.selectSequenceSet(key),
      )
    } else {
      void replaceTableRows(this.table,rows).then(() => this.syncSelectedRow())
    }
  }

  private syncSelectedRow(): void {
    if (!this.table) return
    this.table.deselectRow()
    if (this.selectedKey && this.table.getRow(this.selectedKey)) this.table.selectRow(this.selectedKey)
  }

  private refreshSiteTable(): void {
    if (!this.visible) return
    this.siteRows = this.data ? gseaSiteTableRows(
      this.payload, this.selectedKey, this.data, this.contrast, this.selectedSites, this.proteinSearch,
    ) : []
    const selected = this.payload ? selectedSequenceSet(this.payload, this.selectedKey) : null
    this.el('#gsea-site-summary').textContent = selected
      ? `${this.selectedSites.size.toLocaleString()} selected sites`
        + ` · set NES ${selected.nes.toFixed(3)} · click a curve hit to select`
      : `${this.selectedSites.size.toLocaleString()} selected sites · choose a sequence set to inspect its curve`
    if (!this.siteTable) {
      this.siteTable = createGseaSiteTable(
        this.el('#gsea-site-table'),
        this.siteRows,
        (row) => this.openSite(row.protein_Id, row.site, this.contrast),
      )
    } else {
      void replaceTableRows(this.siteTable,this.siteRows)
    }
  }

  private selectCurveHit(customdata: unknown): void {
    if (!this.siteTable || !Array.isArray(customdata) || !Array.isArray(customdata[2])) return
    const rank = customdata[0]
    const available = new Set(this.siteRows.map((row) => row.row_key))
    const keys = customdata[2].filter(
      (key): key is string => typeof key === 'string' && available.has(key),
    )
    this.siteTable.deselectRow()
    if (!keys.length) return
    this.siteTable.selectRow(keys)
    void this.siteTable.scrollToRow(keys[0], 'center', false)
    this.el('#gsea-site-summary').textContent = `${keys.length.toLocaleString()} site${keys.length === 1 ? '' : 's'}`
      + ` selected at rank ${String(rank)} · click a row to inspect`
  }

  private async renderPlots(): Promise<void> {
    this.renderPending = true
    if (this.rendering) return
    this.rendering = true
    try {
      while (this.renderPending) {
        this.renderPending = false
        await this.renderCurrentPlots()
      }
    } catch (error) { this.setStatus(error instanceof Error ? error.message : String(error), true) }
    finally { this.rendering = false }
  }

  private async renderCurrentPlots(): Promise<void> {
    if (!this.visible) return
    this.el('#gsea-volcano').hidden=!this.payload
    if (!this.payload) {
      this.el('#gsea-curve').hidden=true
      this.el('#gsea-curve-empty').hidden=false
      this.el('#gsea-curve-empty').textContent=this.enrichment.status
      this.el('#gsea-curve-label').textContent=''
      return
    }
    const payload = this.payload
    await renderFigure(
      this.el<HTMLDivElement>('#gsea-volcano'),
      buildGseaVolcanoFigure(payload, this.fdr, this.selectedKey),
      undefined,
      'gl2d',
      (customdata) => {
        if (Array.isArray(customdata) && typeof customdata[0] === 'string') {
          this.selectSequenceSet(customdata[0])
        }
      },
    )
    if (this.payload !== payload || !this.visible) return
    const figure = buildEnrichmentFigure(payload, this.selectedKey, this.selectedSites)
    const plot = this.el<HTMLDivElement>('#gsea-curve')
    const empty = this.el<HTMLParagraphElement>('#gsea-curve-empty')
    const selected = selectedSequenceSet(payload, this.selectedKey)
    this.el('#gsea-curve-label').textContent = selected?.description ?? ''
    plot.hidden = figure === null
    empty.hidden = figure !== null
    empty.textContent = selected
      ? 'This result does not contain a running enrichment curve for the selected sequence set.'
      : 'No sequence set passes the GSEA FDR cutoff.'
    if (figure) {
      await renderFigure(plot, figure, undefined, 'cartesian', (customdata) => {
        this.selectCurveHit(customdata)
      })
    }
  }
}
