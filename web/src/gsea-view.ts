import { html, type TemplateResult } from 'lit'

export interface GseaViewActions {
  changeGseaResult: (event: Event) => void
  changeGseaFdr: () => void
  searchSequenceSets: () => void
  changeSequenceSet: (event: Event) => void
  changeLeadingEdge: () => void
}

export function renderGseaControls(actions: GseaViewActions): TemplateResult {
  return html`
    <div id="gsea-controls" class="gsea-controls" hidden>
      <div class="control gsea-result"><label for="gsea-result">Enrichment result</label><select id="gsea-result" @change=${actions.changeGseaResult}></select></div>
      <div class="control sequence-search"><label for="sequence-set-search">Find sequence set</label><input id="sequence-set-search" type="search" placeholder="Kinase or set name" @input=${actions.searchSequenceSets} /></div>
      <div class="control sequence-set"><label for="sequence-set">Running curve for</label><select id="sequence-set" aria-describedby="sequence-set-help" @change=${actions.changeSequenceSet}></select><span id="sequence-set-help" class="subtle">Display only; B selects sites.</span></div>
      <label class="gsea-checkbox"><input id="leading-edge-only" type="checkbox" @change=${actions.changeLeadingEdge} /> Leading edge only</label>
    </div>`
}

export function renderGseaFindPanel(): TemplateResult {
  return html`
    <div id="gsea-workspace" class="gsea-find-panel" aria-label="GSEA results" hidden>
      <div class="gsea-grid">
        <div class="card">
          <div class="card-title"><span>Sequence-set enrichment</span><small id="gsea-result-count"></small></div>
          <div class="card-body"><div id="gsea-volcano" class="plot-host"></div></div>
        </div>
        <div class="card">
          <div class="card-title"><span>Sequence sets</span><small>Click a row to show its curve</small></div>
          <div class="card-body flush"><div id="gsea-table" class="table-host gsea-table"></div></div>
        </div>
        <div class="card gsea-curve-card">
          <div class="card-title"><span>Running enrichment</span><small id="gsea-curve-label"></small></div>
          <div class="card-body"><div id="gsea-curve" class="plot-host"></div><p id="gsea-curve-empty" class="empty-note" hidden></p></div>
        </div>
        <div class="card gsea-sites-card">
          <div class="card-title"><span>Selected sites</span><small id="gsea-site-summary">Choose a sequence set</small></div>
          <div class="card-body flush"><div id="gsea-site-table" class="table-host gsea-site-table"></div></div>
        </div>
      </div>
    </div>`
}
