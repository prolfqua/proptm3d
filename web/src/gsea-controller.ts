import type { TabulatorFull } from 'tabulator-tables'

import { renderFigure } from './charts.js'
import { loadGseaPayload } from './data.js'
import {
  buildEnrichmentFigure,
  buildGseaVolcanoFigure,
  filterSitesByGsea,
  gseaSiteKeys,
  selectedSequenceSet,
  sequenceSetKey,
  sequenceSetsAtFdr,
  type SiteIdentity,
} from './gsea.js'
import { createGseaTable, gseaTableRows } from './gsea-table.js'
import type { GseaPayload, RunManifest } from './types.js'

type Status = (message: string, error?: boolean) => void

export class GseaController {
  private run: RunManifest | null = null
  private payload: GseaPayload | null = null
  private resultId = ''
  private contrast = ''
  private selectedKey = ''
  private fdr = 0.05
  private sequenceSearch = ''
  private filterEnabled = false
  private leadingEdgeOnly = false
  private loadId = 0
  private visible = false
  private table: TabulatorFull | null = null

  constructor(
    private readonly root: HTMLElement,
    private readonly scopeChanged: () => void,
    private readonly setStatus: Status,
  ) {}

  private el<T extends HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector)
    if (!element) throw new Error(`Missing GSEA view element ${selector}`)
    return element
  }

  async configure(run: RunManifest, contrast: string): Promise<void> {
    if (!run.gsea?.results.length) return
    this.run = run
    this.contrast = contrast
    const select = this.el<HTMLSelectElement>('#gsea-result')
    select.replaceChildren(...run.gsea.results.map((result) => new Option(result.label, result.id)))
    this.resultId = run.gsea.results[0].id
    select.value = this.resultId
    this.el('#gsea-controls').hidden = false
    this.el('#gsea-main-tab').hidden = false
    await this.load()
  }

  dispose(): void {
    this.table?.destroy()
  }

  get filterKey(): string {
    return this.filterEnabled
      ? [this.resultId, this.contrast, this.selectedKey, this.leadingEdgeOnly].join('\u0000')
      : ''
  }

  get isFiltering(): boolean {
    return this.filterEnabled
  }

  filterSites<T extends SiteIdentity>(rows: readonly T[]): T[] {
    if (!this.filterEnabled) return [...rows]
    if (!this.payload || !this.selectedKey) return [...rows]
    return filterSitesByGsea(rows, this.payload, this.selectedKey, this.leadingEdgeOnly)
  }

  async setContrast(contrast: string): Promise<void> {
    if (!this.run || contrast === this.contrast) return
    this.contrast = contrast
    await this.load()
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    if (visible) {
      this.table?.redraw(true)
      void this.renderPlots()
    }
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
    const wasFiltering = this.filterEnabled
    const changed = this.syncSequenceSet()
    this.refreshTable()
    void this.renderPlots()
    if (changed && (wasFiltering || this.filterEnabled)) this.scopeChanged()
  }

  searchSequenceSets(): void {
    this.sequenceSearch = this.el<HTMLInputElement>('#sequence-set-search').value
      .trim().toLocaleLowerCase()
    this.syncSequenceSetOptions()
  }

  changeSequenceSet(event: Event): void {
    this.selectSequenceSet((event.target as HTMLSelectElement).value)
  }

  changeLeadingEdge(): void {
    this.leadingEdgeOnly = this.el<HTMLInputElement>('#leading-edge-only').checked
    this.syncFilterControl()
    if (this.filterEnabled) this.scopeChanged()
  }

  toggleFilter(): void {
    if (!this.payload || !this.selectedKey) return
    this.filterEnabled = !this.filterEnabled
    this.syncFilterControl()
    this.scopeChanged()
  }

  private async load(): Promise<void> {
    if (!this.run) return
    const id = ++this.loadId
    const wasFiltering = this.filterEnabled
    this.payload = null
    if (wasFiltering) this.scopeChanged()
    this.setStatus(`Loading ${this.resultId} for ${this.contrast}…`)
    try {
      const payload = await loadGseaPayload(this.run, this.resultId, this.contrast)
      if (id !== this.loadId) return
      this.payload = payload
      this.syncSequenceSet()
      this.refreshTable()
      this.syncFilterControl()
      if (this.visible) await this.renderPlots()
      if (wasFiltering || this.filterEnabled) this.scopeChanged()
      this.setStatus(payload ? 'Ready · local prepared GSEA data' : 'No GSEA result for this contrast.')
    } catch (error) {
      if (id !== this.loadId) return
      this.selectedKey = ''
      this.filterEnabled = false
      this.syncSequenceSetOptions([])
      this.syncFilterControl()
      if (wasFiltering) this.scopeChanged()
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
    if (!this.selectedKey) this.filterEnabled = false
    this.syncSequenceSetOptions(options)
    return previous !== this.selectedKey
  }

  private syncSequenceSetOptions(
    available = this.payload ? sequenceSetsAtFdr(this.payload, this.fdr) : [],
  ): void {
    const matching = this.sequenceSearch
      ? available.filter((row) => [row.sequence_set, row.description, row.source]
        .some((value) => value.toLocaleLowerCase().includes(this.sequenceSearch)))
      : available
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
  }

  private selectSequenceSet(key: string): void {
    if (!this.payload || !selectedSequenceSet(this.payload, key)) return
    const changed = key !== this.selectedKey
    this.selectedKey = key
    this.el<HTMLSelectElement>('#sequence-set').value = key
    this.syncSelectedRow()
    this.syncFilterControl()
    void this.renderPlots()
    if (changed && this.filterEnabled) this.scopeChanged()
  }

  private refreshTable(): void {
    const sequenceSets = this.payload ? sequenceSetsAtFdr(this.payload, this.fdr) : []
    const rows = gseaTableRows(sequenceSets)
    const count = this.payload?.sequenceSets.length ?? 0
    this.el('#gsea-result-count').textContent = `${rows.length.toLocaleString()} / ${count.toLocaleString()} below FDR`
    if (!this.table) {
      this.table = createGseaTable(
        this.el('#gsea-table'), rows, (key) => this.selectSequenceSet(key),
      )
    } else {
      void this.table.replaceData(rows).then(() => this.syncSelectedRow())
    }
  }

  private syncSelectedRow(): void {
    if (!this.table) return
    this.table.deselectRow()
    if (this.selectedKey && this.table.getRow(this.selectedKey)) this.table.selectRow(this.selectedKey)
  }

  private syncFilterControl(): void {
    const button = this.el<HTMLButtonElement>('#gsea-filter-enabled')
    button.classList.toggle('is-active', this.filterEnabled)
    button.disabled = !this.payload || !this.selectedKey
    this.el('#gsea-filter-state').textContent = this.filterEnabled ? 'On' : 'Off'
    const selected = this.payload ? selectedSequenceSet(this.payload, this.selectedKey) : null
    const count = this.payload && selected
      ? gseaSiteKeys(this.payload, this.selectedKey, this.leadingEdgeOnly).size
      : 0
    this.el('#gsea-filter-label').textContent = selected
      ? `${count.toLocaleString()} ${this.leadingEdgeOnly ? 'leading-edge ' : ''}sites`
      : 'Apply sequence set'
  }

  private async renderPlots(): Promise<void> {
    if (!this.visible || !this.payload) return
    await renderFigure(
      this.el<HTMLDivElement>('#gsea-volcano'),
      buildGseaVolcanoFigure(this.payload, this.fdr, this.selectedKey),
      undefined,
      'gl2d',
      (customdata) => {
        if (Array.isArray(customdata) && typeof customdata[0] === 'string') {
          this.selectSequenceSet(customdata[0])
        }
      },
    )
    const figure = buildEnrichmentFigure(this.payload, this.selectedKey)
    const plot = this.el<HTMLDivElement>('#gsea-curve')
    const empty = this.el<HTMLParagraphElement>('#gsea-curve-empty')
    const selected = selectedSequenceSet(this.payload, this.selectedKey)
    this.el('#gsea-curve-label').textContent = selected?.description ?? ''
    plot.hidden = figure === null
    empty.hidden = figure !== null
    empty.textContent = selected
      ? 'This result does not contain a running enrichment curve for the selected sequence set.'
      : 'No sequence set passes the GSEA FDR cutoff.'
    if (figure) await renderFigure(plot, figure)
  }
}
