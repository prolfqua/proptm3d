import { html, type TemplateResult } from 'lit'
import { renderFilters } from './filter-panel.js'
import type { BrowserProfile } from './browser-profile.js'
import type { GseaViewActions } from './gsea-view.js'

export type MainView = 'find' | 'protein' | 'abundance'
export type FindView = 'all' | 'single' | 'sequlogos' | 'gsea'
export type DetailView = 'structure' | 'ntoc' | 'pae'

export interface AppViewActions extends GseaViewActions {
  toggleGuide: (open?: boolean) => void
  changeThresholds: () => void
  changeDisplayedContrast: (event: Event) => void
  changeEstimateType: (event: Event) => void
  changeStructuralFilters: () => void
  refreshSummary: () => void
  showMain: (view: MainView) => void
  showFind: (view: FindView) => void
  showDetailView: (view: DetailView) => void
  changeStructureStyle: () => void
}

export function renderApp(actions: AppViewActions, profile: BrowserProfile): TemplateResult {
  return html`
    <header class="masthead">
      <div class="brand"><div class="brand-mark">3D</div><div><h1>proptm3d</h1><p>Phosphosite structure explorer</p></div></div>
      <div class="run-meta"><span id="method-pill" class="pill method">Loading</span><span id="run-counts" class="pill"></span></div>
      <div id="app-status" class="status" role="status">Loading prepared data…</div>
      <button id="guide-toggle" class="guide-toggle" type="button" aria-controls="reading-guide" aria-expanded="false" @click=${() => actions.toggleGuide()}>How to read this</button>
    </header>
    <aside id="reading-guide" class="reading-guide" aria-label="Data and color explanations" hidden @keydown=${(event: KeyboardEvent) => { if (event.key === 'Escape') actions.toggleGuide(false) }}>
      <div class="guide-heading"><h2>How to read this</h2><button type="button" aria-label="Close explanations" @click=${() => actions.toggleGuide(false)}>×</button></div>
      <dl>
        <dt>Estimate</dt><dd>Observed uses measured site abundance. LOD imputed means a value below the limit of detection was imputed in the upstream analysis. All does not filter by estimate type; the global filtering switch shows every measured site without clearing A, B or C.</dd>
        <dt>Exposure</dt><dd>Predicted residue exposure from the AlphaFold model, using the PAE-aware StructureMap neighborhood. Exposed means at most five qualifying neighbors in a 12 Å, 70° partial sphere; buried means more than five. This is not an experimental measurement of solvent accessibility.</dd>
        <dt>Region</dt><dd>IDR means predicted intrinsically disordered region; structured means not classified as IDR. The call uses smoothed PAE-aware neighbors in a 24 Å sphere. Sites without matched model context are neither category.</dd>
        <dt>pLDDT</dt><dd>AlphaFold's per-residue local confidence score, 0–100; higher is more confident. It is not an exposure or disorder measurement.</dd>
        <dt>UniProt features</dt><dd>Prepared UniProt domains, regions, motifs, repeats, transmembrane segments and signal peptides. Generic Chain intervals are not colored. Only exact coordinates on a sequence-matched protein are colored; unannotated residues are gray. More specific feature types take precedence where intervals overlap.</dd>
        <dt>FDR and |log2FC|</dt><dd>A site passes only when FDR is strictly below the selected cutoff and absolute log2 fold change is strictly above the selected cutoff. These filters do not change the underlying abundance values.</dd>
        <dt>Plot selection colors</dt><dd>Red/blue points are selected and pass the site thresholds in the contrast context. Orange points are selected but outside those thresholds here. Sites without plot coordinates stay in the protein table; counts below each plot report omissions instead of placing missing values at zero.</dd>
        <dt>UpSet intersections</dt>
        <dd>${profile.guideUpSet}</dd>
      </dl>
    </aside>
    ${renderFilters({
      a: html`<div class="control threshold"><label for="fdr-cutoff">Site FDR &lt;</label><input id="fdr-cutoff" type="number" min="0" max="1" step="0.01" value="0.05" @input=${actions.changeThresholds} /></div>
        <div class="control threshold"><label for="effect-cutoff">|log2FC| &gt;</label><input id="effect-cutoff" type="number" min="0" step="0.1" value="1" @input=${actions.changeThresholds} /></div>`,
      b: profile.enrichment?.renderFilterControls(actions) ?? html``,
      c: html`<div class="control estimate"><label for="estimate-type">Estimate · upper contrast</label><select id="estimate-type" title="When enabled, Estimate uses the contrast selected above." @change=${actions.changeEstimateType}><option value="all">All</option><option value="observed">Observed</option><option value="lod_imputed">LOD imputed</option></select></div>
        <div class="control structural"><label for="exposure-filter">Exposure</label><select id="exposure-filter" title="Exposure sets require matched AlphaFold context. All disables this operand; other C operands may still select unmatched sites." @change=${actions.changeStructuralFilters}><option value="all">All</option><option value="exposed">Exposed</option><option value="buried">Buried</option></select></div>
        <div class="control structural"><label for="region-filter">Region</label><select id="region-filter" title="Region sets require matched AlphaFold context. All disables this operand; other C operands may still select unmatched sites." @change=${actions.changeStructuralFilters}><option value="all">All</option><option value="idr">IDR</option><option value="structured">Structured</option></select></div>`,
    }, html`
      <div class="control"><label for="displayed-contrast">${profile.contrastLabel}</label><select id="displayed-contrast" @change=${actions.changeDisplayedContrast}></select></div>
      ${profile.enrichment?.renderNavigation(actions)}
      <div class="control global-search"><label for="find-search">Find protein</label><input id="find-search" type="search" placeholder="Gene, ID or accession" @input=${actions.refreshSummary} /></div>
    `, profile)}
    <nav class="main-tabs" aria-label="Workspaces">
      <button type="button" data-main="find" aria-selected="true" @click=${() => actions.showMain('find')}>Find proteins</button>
      <button type="button" data-main="protein" aria-selected="false" @click=${() => actions.showMain('protein')}>Protein detail</button>
      <button type="button" data-main="abundance" aria-selected="false" @click=${() => actions.showMain('abundance')}>Site abundance</button>
    </nav>
    <main>
      <section id="find-workspace" class="workspace" aria-label="Find proteins">
        <nav class="find-tabs" aria-label="Find scope">
          <button type="button" data-find="all" aria-selected="true" @click=${() => actions.showFind('all')}>All contrasts</button>
          <button type="button" data-find="single" aria-selected="false" @click=${() => actions.showFind('single')}>Single contrast</button>
          <button type="button" data-find="sequlogos" aria-selected="false" @click=${() => actions.showFind('sequlogos')}>Single contrast sequlogos</button>
          ${profile.enrichment?.renderFindTab(() => actions.showFind('gsea'))}
        </nav>
        ${profile.enrichment?.renderFindPanel()}
        <div id="find-grid" class="find-grid all-contrasts">
          <div class="card"><div class="card-title"><span id="find-count" class="scope-count">Proteins</span><small id="find-row-hint">Click a row to inspect its sites</small></div><div class="card-body flush"><div id="find-table" class="table-host"></div></div></div>
          <div id="focused-plots" class="focused-plots" hidden>
            <div class="card"><div class="card-body"><div id="focus-volcano-plot" class="plot-host"></div><div id="focus-volcano-note" class="metric-note"></div></div></div>
            <div class="card"><div class="card-body"><div id="focus-protein-site-plot" class="plot-host"></div><div id="focus-protein-site-note" class="metric-note"></div></div></div>
          </div>
        </div>
        <div id="find-plots" class="plot-grid" hidden>
          <div class="card"><div class="card-body"><div id="volcano-plot" class="plot-host"></div><div id="volcano-note" class="metric-note"></div></div></div>
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
              <span id="protein-links" class="protein-links" hidden><a id="uniprot-link" target="_blank" rel="noopener noreferrer">UniProt ↗</a><a id="string-link" target="_blank" rel="noopener noreferrer">STRING ↗</a></span>
            </div>
          </div>
        </div>
        <div id="protein-content" hidden>
          <div class="protein-grid">
            <div class="card"><div class="card-title">Sites and results <small id="detail-count"></small></div><div class="card-body flush"><div id="detail-table" class="table-host detail-table"></div></div><div class="metric-note">Click a row to select its site.</div></div>
            <div class="detail-views">
              <nav class="detail-tabs" aria-label="Protein views">
                <button type="button" data-detail="structure" aria-selected="true" @click=${() => actions.showDetailView('structure')}>3D structure</button>
                <button type="button" data-detail="ntoc" aria-selected="false" @click=${() => actions.showDetailView('ntoc')}>N-to-C lollipop</button>
                <button type="button" data-detail="pae" aria-selected="false" @click=${() => actions.showDetailView('pae')}>PAE</button>
              </nav>
              <div id="structure-panel" class="card"><div class="view-note">Red up · blue down · gray no effect</div>
                <div class="viewer-controls">
                  <div class="control"><label for="structure-representation">Representation</label><select id="structure-representation" @change=${actions.changeStructureStyle}><option value="cartoon">Cartoon</option><option value="backbone">Backbone trace</option><option value="surface">Surface</option></select></div>
                  <div class="control"><label for="structure-coloring">Structure color</label><select id="structure-coloring" @change=${actions.changeStructureStyle}><option value="plddt">pLDDT confidence</option><option value="exposure">Exposure</option><option value="region">Region / IDR</option><option value="uniprot">UniProt features</option><option value="position">N-to-C position</option><option value="neutral">Neutral</option></select></div>
                </div>
                <div id="structure-color-legend" class="structure-color-legend">pLDDT: blue high confidence · yellow/orange lower confidence</div>
                <div id="uniprot-color-legend" class="structure-feature-legend" hidden><span><i style="background:#d28b3b"></i>Motif</span><span><i style="background:#59a276"></i>Signal</span><span><i style="background:#c56551"></i>Transmembrane</span><span><i style="background:#4c9699"></i>Repeat</span><span><i style="background:#8866a6"></i>Region</span><span><i style="background:#526da7"></i>Domain</span><span><i style="background:#a9b6c3"></i>No exact feature</span></div>
                <div id="structure-view" class="structure-host"></div><div id="structure-status" class="viewer-status" role="status"></div>
              </div>
              <div id="ntoc-panel" class="card" hidden><div class="view-note">Sticks: method log2FC · dashed/open: imputed · ×: no estimate · Tracks: teal exposed / amber buried · purple IDR / blue structured · pLDDT blue high / orange low</div><div id="ntoc-plot" class="ntoc-host"></div></div>
              <div id="pae-panel" class="card" hidden><div class="view-note">Predicted aligned error · dark: confident relative placement · light: uncertain relative placement · dotted: selected site</div><div id="pae-plot" class="pae-host"></div><div id="pae-status" class="viewer-status" role="status"></div></div>
            </div>
          </div>
          <div class="controls" style="margin-top:0.9rem"><button type="button" @click=${() => actions.showMain('abundance')}>Open selected site's abundance →</button><span id="selected-site-note" class="subtle"></span></div>
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
