import { html, render, type TemplateResult } from 'lit'
import { FilterModel, type EnrichmentInput, type FilterBranch } from './filtering.js'
import { filterStatus } from './filter-status.js'
import { displayedUpSet, intersectionDegrees, rankedUpSetDisplay, resolveSelection, selectionLabel,
  UPSET_PAGE_SIZE, type SetSelection } from './upset-model.js'
import { UpSetPlot } from './upset.js'
import type { AppData, Thresholds } from './types.js'
import type { EstimateType } from './detail.js'
import type { StructuralFilters } from './structural.js'
import type { BrowserProfile } from './browser-profile.js'

type Branch = FilterBranch

export function renderFilters(controls: Record<Branch,TemplateResult>, navigation: TemplateResult,
  profile: BrowserProfile): TemplateResult {
  return html`<section class="filter-navigation" aria-label="Display and protein navigation">
    ${navigation}
    <span class="subtle">${profile.navigationHint}</span>
  </section>
  <section class="filter-panel" aria-label="Shared site filtering">
    <div id="filter-state-bar" class="filter-state-bar">
      <button id="toggle-filters" type="button" aria-controls="filter-body" aria-expanded="true">Hide filters</button>
      <button id="toggle-filtering" type="button" aria-pressed="false">Filtering: On</button>
      <span id="filter-summary" class="filter-summary" role="status">Loading filter selection…</span>
    </div>
    <div id="filter-body">
      <div id="filter-upset-panel" class="filter-upsets ${profile.id}">
      ${profile.branches.map(branch=>html`<div id="filter-${branch}-card" class="card filter-upset-card">
        <div class="card-title"><span>${{a:'A · Significant-site intersections',b:'B · Significant sequence_set intersections',c:'C · Filter intersections'}[branch]}</span><small id="filter-${branch}-count"></small></div>
        <div id="filter-${branch}-control" class="filter-branch-control">
          <strong>${{a:'Contrast selection',b:'Sequence_set selection',c:'C selection'}[branch]}</strong>
          <button data-filter-branch=${branch} data-filter-mode="off">Off</button>
          <button data-filter-branch=${branch} data-filter-mode="all">All</button>
          <span id="filter-${branch}-label"></span>
        </div>
        <div class="upset-controls">
          ${controls[branch]}
          ${branch==='c'?html`<span class="subtle combined-preview-note">C Off disables C only; A and B still select sites. C All applies the union of enabled sets; its exact columns partition that union. Global Filtering: Off shows all measured sites; open Inspect filters to see the saved filter preview.</span>`:''}
          ${branch==='c'?'':html`<div class="control"><label for="filter-${branch}-degree">Dots per intersection</label>
            <select id="filter-${branch}-degree" data-upset-degree=${branch} aria-describedby="filter-${branch}-degree-help"></select></div>
          <span id="filter-${branch}-degree-help" class="subtle">Display only · 1 dot = exclusive to one set</span>`}
          ${branch==='b'?html`<span id="filter-b-search-note" class="subtle" hidden></span>`:''}
        </div>
        <div class="upset-scroll"><div id="filter-${branch}-plot" class="upset-plot"></div></div>
        ${branch==='c'?'':html`<div class="upset-page"><button data-upset-page=${branch} data-direction="-1">Previous</button><span id="filter-${branch}-page"></span><button data-upset-page=${branch} data-direction="1">Next</button></div>`}
      </div>`)}
      </div>
      <p id="filter-notice" class="metric-note" role="status">${profile.filterNotice}</p>
    </div>
  </section>`
}

/** Presentation of one shared selection state; no view-specific predicates. */
export class FilterPanel {
  private pages = {a:0,b:0}
  private degrees = {a:0,b:0}
  private plots: Partial<Record<Branch,UpSetPlot>>
  private sequenceMatches: ReadonlySet<string> | null = null
  private bContrast = ''
  private bResult = ''
  private displayedContrast = ''
  private hiddenBeforeGlobalOff = false
  private rendering = false
  private pending = false

  get state() { return this.model.state }
  get revision() { return this.model.revision }
  get siteKeys() { return this.model.siteKeys }

  constructor(private root: HTMLElement, readonly model: FilterModel, private changed: () => void,
    private error: (message:string)=>void, private profile: BrowserProfile) {
    this.plots=Object.fromEntries(profile.branches.map(branch=>[branch,new UpSetPlot(
      this.el<HTMLDivElement>(`#filter-${branch}-plot`),`${branch.toUpperCase()} UpSet display`,
      selection=>this.select(branch,selection),()=>{
        if (branch!=='c') this.pages[branch]=0
        void this.draw()
      },
    )])) as Partial<Record<Branch,UpSetPlot>>
    this.el<HTMLButtonElement>('#toggle-filters').onclick=()=>{
      this.setBodyHidden(!this.el('#filter-body').hidden)
      if (this.state.globalOff) this.hiddenBeforeGlobalOff=Boolean(this.el('#filter-body').hidden)
    }
    this.el<HTMLButtonElement>('#toggle-filtering').onclick=()=>{
      if (this.model.setGlobalOff(!this.state.globalOff)) {
        if (this.state.globalOff) {
          this.hiddenBeforeGlobalOff=Boolean(this.el('#filter-body').hidden)
          this.setBodyHidden(true)
        } else this.setBodyHidden(this.hiddenBeforeGlobalOff)
        this.renderState(); this.changed()
      }
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-filter-branch]')) {
      button.onclick=()=>this.select(button.dataset.filterBranch as Branch,{kind:button.dataset.filterMode as 'off'|'all'})
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-upset-page]')) button.onclick=()=>{
      this.pages[button.dataset.upsetPage as 'a'|'b']+=Number(button.dataset.direction)
      void this.draw()
    }
    for (const control of root.querySelectorAll<HTMLSelectElement>('[data-upset-degree]')) control.onchange=()=>{
      const branch=control.dataset.upsetDegree as 'a'|'b'
      this.degrees[branch]=Number(control.value)
      this.pages[branch]=0
      void this.draw()
    }
  }

  private el<T extends HTMLElement>(selector:string): T { return this.root.querySelector<T>(selector)! }

  private setBodyHidden(hidden:boolean): void {
    const body=this.el('#filter-body')
    body.hidden=hidden
    const button=this.el<HTMLButtonElement>('#toggle-filters')
    button.textContent=this.state.globalOff
      ? hidden?'Inspect filters':'Hide preview'
      : hidden?'Show filters':'Hide filters'
    button.setAttribute('aria-expanded',String(!hidden))
    if (!hidden) void this.draw()
  }

  findSequenceSets(matches: ReadonlySet<string> | null): void {
    if (this.profile.id!=='gsea') return
    if (matches===this.sequenceMatches || (matches!==null && this.sequenceMatches!==null
      && matches.size===this.sequenceMatches.size && [...matches].every(id=>this.sequenceMatches!.has(id)))) return
    this.sequenceMatches=matches
    this.pages.b=0
    const note=this.el('#filter-b-search-note')
    note.hidden=matches===null
    if (matches!==null) note.textContent=`${matches.size} matching sequence set${matches.size===1?'':'s'} first; columns show their intersections with all eligible sets. B selection unchanged.`
    void this.draw()
  }

  update(data:AppData, contrast:string, thresholds:Thresholds, estimate:EstimateType,
    structural:StructuralFilters, enrichment:EnrichmentInput): void {
    this.bContrast=enrichment.context.split('\u0000')[1]??''
    const resultId=enrichment.context.split('\u0000')[0]
    this.bResult=data.run.gsea?.results.find(result=>result.id===resultId)?.label??resultId
    this.displayedContrast=contrast
    const result=this.model.update(data,contrast,thresholds,estimate,structural,enrichment)
    if (!result.changed) return
    if (result.notice) this.el('#filter-notice').textContent=result.notice
    this.pages={a:0,b:0}
    this.renderState()
  }

  private select(branch:Branch, selection:SetSelection): void {
    if (!this.model.select(branch,selection)) return
    if (selection.kind==='set'||selection.kind==='intersection') this.plots[branch]?.focusSelection()
    if (branch!=='c') this.pages[branch]=0
    this.el('#filter-notice').textContent=branch==='c'
      ? 'C Off disables C only; A and B remain effective. C All applies their union with enabled properties.'
      : this.state.c.kind==='off'
        ? 'Upstream selection changed. C remains Off; A and B still select sites.'
        : 'Upstream selection changed. C is all (union); choose a C intersection to require a particular combination.'
    this.renderState(); this.changed()
  }

  private renderState(): void {
    for (const branch of this.profile.branches) {
      const model=this.model.get(branch),selection=this.state[branch]
      const count=branch==='c'?this.model.filteredSiteKeys.size
        :(resolveSelection(model,selection)?.size??this.model.universeSize)
      const label=this.el(`#filter-${branch}-label`)
      label.textContent=`${selectionLabel(model,selection)} · ${count.toLocaleString()} sites${branch==='c'&&this.state.globalOff?' if filtering on':''}`
      label.title=label.textContent
    }
    const status=filterStatus(this.model,this.profile.branches,this.displayedContrast,
      this.bResult,this.bContrast)
    const summary=this.el('#filter-summary')
    summary.textContent=status.text
    summary.title=summary.textContent
    this.el('#filter-state-bar').classList.toggle('has-active-filters',status.active)
    const filtering=this.el<HTMLButtonElement>('#toggle-filtering')
    filtering.textContent=this.state.globalOff?'Filtering: Off':'Filtering: On'
    filtering.setAttribute('aria-pressed',String(this.state.globalOff))
    filtering.setAttribute('aria-label',this.state.globalOff?'Turn site filtering on':'Turn site filtering off')
    if (this.profile.id==='gsea') {
      this.el('#filter-b-control').hidden=this.el('#filter-b-card').hidden=!this.model.includeB
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-filter-branch]')) {
      const branch=button.dataset.filterBranch as Branch
      button.disabled=branch==='b'&&!this.model.enrichmentReady&&button.dataset.filterMode!=='off'
      button.setAttribute('aria-pressed',String(this.state[branch].kind===button.dataset.filterMode))
    }
    if (this.model.includeB&&!this.model.enrichmentReady) this.el('#filter-b-count').textContent=this.model.enrichmentStatus
    void this.draw()
  }

  private async draw(): Promise<void> {
    if (this.el('#filter-body').hidden) return
    this.pending=true
    if (this.rendering) return
    this.rendering=true
    try {
      while (this.pending) {
        this.pending=false
        for (const branch of this.profile.branches) {
          if (branch==='b'&&!this.model.includeB) continue
          const source=this.model.get(branch)
          let degree=0, page=0
          if (branch!=='c') {
            const searched=branch==='b'?rankedUpSetDisplay(source,0,this.sequenceMatches):source
            const degrees=intersectionDegrees(searched,this.state[branch],this.plots[branch]!.mode)
            if (this.degrees[branch] && !degrees.includes(this.degrees[branch])) {
              this.degrees[branch]=0; this.pages[branch]=0
            }
            degree=this.degrees[branch]
          }
          const model=branch==='b'?rankedUpSetDisplay(source,degree,this.sequenceMatches):source
          const displayed=displayedUpSet(model,this.state[branch],this.plots[branch]!.mode,degree)
          const activeSets=model.sets.filter(s=>s.enabled).length
          const hasSelection=['set','intersection'].includes(this.state[branch].kind)
          const focused=this.plots[branch]!.mode==='selected' && hasSelection
          this.el(`#filter-${branch}-count`).textContent=branch==='b'&&!this.model.enrichmentReady?this.model.enrichmentStatus:
            `${activeSets} active set${activeSets===1?'':'s'}${focused?` · ${displayed.sets.length} rows / ${displayed.intersections.length} columns shown`:branch==='c'?` · ${displayed.intersections.length} shown`:''}${branch==='b'&&this.sequenceMatches!==null?` · ${this.sequenceMatches.size} found`:''}`
          if (branch!=='c') {
            const degrees=intersectionDegrees(model,this.state[branch],this.plots[branch]!.mode)
            const count=displayed.intersections.length
            const pages=Math.max(1,Math.ceil(count/UPSET_PAGE_SIZE))
            const control=this.el<HTMLSelectElement>(`#filter-${branch}-degree`)
            render(html`<option value="0">All intersections</option>
              ${degrees.map(n=>html`<option value=${n}>${n} ${n===1?'dot (exclusive)':'dots'}</option>`)}`,control)
            control.value=String(degree)
            this.pages[branch]=Math.min(this.pages[branch],pages-1)
            page=this.pages[branch]
            this.el(`#filter-${branch}-page`).textContent=`Page ${page+1} / ${pages} · ${count.toLocaleString()}${degree?` / ${model.intersections.length.toLocaleString()}`:''}${branch==='b'&&this.sequenceMatches!==null?' matching':''} exact intersections`
            for (const button of this.root.querySelectorAll<HTMLButtonElement>(`[data-upset-page="${branch}"]`)) {
              button.disabled=Number(button.dataset.direction)<0?page===0:page>=pages-1
            }
          }
          await this.plots[branch]!.render(model,this.state[branch],page,branch==='a',degree)
        }
      }
    } catch(error) {this.error(error instanceof Error?error.message:String(error))}
    finally {this.rendering=false}
  }
}
