import { html, type TemplateResult } from 'lit'

export interface GseaViewActions {
  changeGseaResult: (event: Event) => void
  changeGseaFdr: () => void
  searchSequenceSets: () => void
  changeSequenceSet: (event: Event) => void
  changeLeadingEdge: () => void
  toggleGseaFilter: () => void
}

export function renderGseaControls(actions: GseaViewActions): TemplateResult {
  return html`
    <div id="gsea-controls" class="gsea-controls" hidden>
      <div class="control gsea-result"><label for="gsea-result">Enrichment result</label><select id="gsea-result" @change=${actions.changeGseaResult}></select></div>
      <div class="control threshold"><label for="gsea-fdr">GSEA FDR &lt;</label><input id="gsea-fdr" type="number" min="0" max="1" step="0.01" value="0.05" @input=${actions.changeGseaFdr} /></div>
      <div class="control sequence-search"><label for="sequence-set-search">Find sequence set</label><input id="sequence-set-search" type="search" placeholder="Kinase or set name" @input=${actions.searchSequenceSets} /></div>
      <div class="control sequence-set"><label for="sequence-set">Sequence set</label><select id="sequence-set" @change=${actions.changeSequenceSet}></select></div>
      <label class="gsea-checkbox"><input id="leading-edge-only" type="checkbox" @change=${actions.changeLeadingEdge} /> Leading edge only</label>
      <div class="control gsea-filter">
        <span class="control-label">GSEA selection</span>
        <button id="gsea-filter-enabled" class="filter-toggle" type="button" @click=${actions.toggleGseaFilter}>
          <span id="gsea-filter-state" class="toggle-state">Off</span>
          <span id="gsea-filter-label">Apply sequence set</span>
        </button>
      </div>
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
          <div class="card-title"><span>Sequence sets</span><small>Click a row to select</small></div>
          <div class="card-body flush"><div id="gsea-table" class="table-host gsea-table"></div></div>
        </div>
        <div class="card gsea-curve-card">
          <div class="card-title"><span>Running enrichment</span><small id="gsea-curve-label"></small></div>
          <div class="card-body"><div id="gsea-curve" class="plot-host"></div><p id="gsea-curve-empty" class="empty-note" hidden></p></div>
        </div>
      </div>
    </div>`
}
