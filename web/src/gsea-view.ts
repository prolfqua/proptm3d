import { html, type TemplateResult } from 'lit'

export interface GseaViewActions {
  changeGseaResult: (event: Event) => void
  changeSequenceSet: (event: Event) => void
  changeGseaFdr: () => void
  searchSequenceSets: () => void
  changeLeadingEdge: () => void
}

export function renderGseaNavigation(actions: GseaViewActions): TemplateResult {
  return html`<div id="gsea-navigation" class="gsea-navigation" hidden>
    <div class="control gsea-result"><label for="gsea-result">GSEA method</label><select id="gsea-result" @change=${actions.changeGseaResult}></select></div>
    <div class="control sequence-set"><label for="sequence-set">Sequence set · running curve</label><select id="sequence-set" title="Choose a running curve for display; B selects sites." @change=${actions.changeSequenceSet}></select></div>
  </div>`
}

export function renderGseaControls(actions: GseaViewActions): TemplateResult {
  return html`
    <div id="gsea-controls" class="gsea-controls" hidden>
      <div class="control threshold"><label for="gsea-fdr">GSEA FDR &lt;</label><input id="gsea-fdr" type="number" min="0" max="1" step="0.01" value="0.05" @input=${actions.changeGseaFdr} /></div>
      <div class="control sequence-search"><label for="sequence-set-search">Find sequence set</label><input id="sequence-set-search" type="search" placeholder="Kinase or set name" @input=${actions.searchSequenceSets} /></div>
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
          <div class="card-title"><span>Sequence sets</span><small>Click a row to inspect its curve</small></div>
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
