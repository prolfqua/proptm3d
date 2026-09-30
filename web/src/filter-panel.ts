import { html, render, type TemplateResult } from 'lit'
import { contrastSets, FilterSelection, propertySets, relevantCombinedIntersections } from './filtering.js'
import { computeUpSet, displayedUpSet, intersectionDegrees, rankedUpSetDisplay, resolveSelection, selectionLabel, siteIdentity,
  UPSET_PAGE_SIZE, UpSetPlot, type SetSelection, type SiteSet, type UpSetModel } from './upset.js'
import type { AppData, Thresholds } from './types.js'
import type { EstimateType } from './detail.js'
import type { StructuralFilters } from './structural.js'

type Branch = 'a' | 'b' | 'c'
export interface EnrichmentSets {
  sets: SiteSet[]
  context: string
  revision: number
  status: string
  ready: boolean
}

export function renderFilters(controls: Record<Branch,TemplateResult>, navigation: TemplateResult): TemplateResult {
  return html`<section class="filter-panel" aria-label="Shared site filtering">
    <div class="filter-state-bar">
      <button id="toggle-filters" type="button" aria-controls="filter-body" aria-expanded="true">Hide filters</button>
      <span id="filter-summary" class="filter-summary">Loading filter selection…</span>
    </div>
    <div class="filter-navigation" aria-label="Display and protein search">
      ${navigation}
      <span class="subtle">Display and search only; these controls do not change A, B or C membership.</span>
    </div>
    <div id="filter-body">
      <div id="filter-upset-panel" class="filter-upsets">
      ${(['b','a','c'] as const).map(branch=>html`<div id="filter-${branch}-card" class="card filter-upset-card">
        <div class="card-title"><span>${{a:'A · Significant-site intersections',b:'B · Significant sequence_set intersections',c:'C · Filter intersections'}[branch]}</span><small id="filter-${branch}-count"></small></div>
        <div id="filter-${branch}-control" class="filter-branch-control ${branch==='c'?'filter-c-control':''}">
          ${branch==='c'?html`<strong>C selection</strong><span id="filter-c-label"></span>
            <button id="clear-c" hidden>Clear C selection</button>`:html`
            <strong>${branch==='a'?'Contrast selection':'Sequence_set selection'}</strong>
            <button data-filter-branch=${branch} data-filter-mode="off">Off</button>
            <button data-filter-branch=${branch} data-filter-mode="all">All</button>
            <span id="filter-${branch}-label"></span>`}
          ${branch==='c'?html`<label class="show-all-sites" title="Temporarily bypass A, B and C without losing their selections"><input id="show-all-sites" type="checkbox"> Show all sites</label>`:''}
        </div>
        <div class="upset-controls">
          ${controls[branch]}
          ${branch==='c'?html`<span class="subtle combined-preview-note">C All is the union of enabled sets, or all measured sites when none is enabled. Columns show sites passing all active property choices and A or B when enabled.</span>`:''}
          ${branch==='c'?'':html`<div class="control"><label for="filter-${branch}-degree">Dots per intersection</label>
            <select id="filter-${branch}-degree" data-upset-degree=${branch} aria-describedby="filter-${branch}-degree-help"></select></div>
          <span id="filter-${branch}-degree-help" class="subtle">Display only · 1 dot = exclusive to one set</span>`}
          ${branch==='b'?html`<span id="filter-b-search-note" class="subtle" hidden></span>`:''}
        </div>
        <div class="upset-scroll"><div id="filter-${branch}-plot" class="upset-plot"></div></div>
        ${branch==='c'?'':html`<div class="upset-page"><button data-upset-page=${branch} data-direction="-1">Previous</button><span id="filter-${branch}-page"></span><button data-upset-page=${branch} data-direction="1">Next</button></div>`}
      </div>`)}
      </div>
      <p id="filter-notice" class="metric-note" role="status">A and B → C. All is inclusive union; Off disables a filter. Bar clicks select sites and focus the UpSet display; View All shows every row and column without changing the selection.</p>
    </div>
  </section>`
}

/** Presentation of one shared selection state; no view-specific predicates. */
export class FilterPanel {
  readonly state = new FilterSelection()
  private models: Record<Branch, UpSetModel> = {a:computeUpSet([]),b:computeUpSet([]),c:computeUpSet([])}
  private pages = {a:0,b:0}
  private degrees = {a:0,b:0}
  private plots: Record<Branch,UpSetPlot>
  private sequenceMatches: ReadonlySet<string> | null = null
  private properties: SiteSet[] = []
  private universe = new Set<string>()
  private includeB = false
  private key = ''
  private context = ''
  private enrichmentReady = true
  private enrichmentStatus = ''
  private rendering = false
  private pending = false
  revision = 0
  siteKeys: ReadonlySet<string> = new Set()

  constructor(private root: HTMLElement, private changed: () => void,
    private focusSet: (id:string)=>void, private error: (message:string)=>void) {
    this.plots=Object.fromEntries((['a','b','c'] as const).map(branch=>[branch,new UpSetPlot(
      this.el<HTMLDivElement>(`#filter-${branch}-plot`),`${branch.toUpperCase()} UpSet display`,
      selection=>this.select(branch,selection),()=>{
        if (branch!=='c') this.pages[branch]=0
        void this.draw()
      },
    )])) as Record<Branch,UpSetPlot>
    this.el<HTMLButtonElement>('#toggle-filters').onclick=()=>{
      const body=this.el('#filter-body')
      body.hidden=!body.hidden
      const button=this.el<HTMLButtonElement>('#toggle-filters')
      button.textContent=body.hidden?'Show filters':'Hide filters'
      button.setAttribute('aria-expanded',String(!body.hidden))
      if (!body.hidden) void this.draw()
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-filter-branch]')) {
      button.onclick=()=>this.select(button.dataset.filterBranch as Branch,{kind:button.dataset.filterMode as 'off'|'all'})
    }
    this.el<HTMLButtonElement>('#clear-c').onclick=()=>this.select('c',{kind:'all'})
    this.el<HTMLInputElement>('#show-all-sites').onchange=event=>{
      this.state.showAll=(event.target as HTMLInputElement).checked
      this.recombine(); this.changed()
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

  findSequenceSets(matches: ReadonlySet<string> | null): void {
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
    structural:StructuralFilters, enrichment:EnrichmentSets): void {
    const key=JSON.stringify([contrast,thresholds,estimate,structural,enrichment.revision])
    if (key===this.key) return
    const previous=this.models.b
    this.includeB=Boolean(data.run.gsea?.results.length)
    this.universe=new Set(data.sites.map(s=>siteIdentity(s.protein_Id,s.site)))
    this.models.a=computeUpSet(contrastSets(data,thresholds))
    this.models.b=computeUpSet(enrichment.sets)
    this.properties=propertySets(data,contrast,estimate,structural)
    this.enrichmentReady=enrichment.ready
    this.enrichmentStatus=enrichment.status
    if (enrichment.ready || enrichment.context!==this.context) {
      if (this.state.reconcileB(previous,this.models.b,enrichment.context!==this.context)) {
        this.el('#filter-notice').textContent='Sequence_set selection reset to all after an enrichment context or eligibility change.'
      }
    }
    this.context=enrichment.context
    if (this.key && this.state.resetCombined()) this.el('#filter-notice').textContent='Upstream filters changed. C returned to all (union); A and B retain their selections.'
    this.key=key; this.pages={a:0,b:0}
    this.recombine()
  }

  private select(branch:Branch, selection:SetSelection): void {
    if ((this.state.showAll && !(branch==='c'&&selection.kind==='all'))
      || (branch==='b'&&!this.enrichmentReady&&selection.kind!=='off')) return
    this.state[branch]=JSON.stringify(this.state[branch])===JSON.stringify(selection) && !['all','off'].includes(selection.kind)
      ? {kind:'all'} : selection
    if (selection.kind==='set'||selection.kind==='intersection') this.plots[branch].focusSelection()
    if (branch!=='c') this.pages[branch]=0
    if (branch!=='c') this.state.resetCombined()
    if (branch==='b' && selection.kind==='set') this.focusSet(selection.id)
    this.el('#filter-notice').textContent=branch==='c'
      ? 'C controls the final site selection. Clearing it returns to union without resetting A or B.'
      : 'Upstream selection changed. C is all (union); choose a C intersection to require a particular combination.'
    this.recombine(); this.changed()
  }

  private recombine(): void {
    this.models.c=this.state.combine(this.models.a,this.models.b,this.properties,this.includeB)
    this.siteKeys=!this.state.showAll && this.state.b.kind!=='off' && !this.enrichmentReady
      ? new Set() : this.state.effective(this.models.c,this.universe)
    this.revision++
    for (const branch of ['a','b','c'] as const) {
      const model=this.models[branch],selection=this.state[branch]
      const count=branch==='c'?this.siteKeys.size:(resolveSelection(model,selection)?.size??this.universe.size)
      const label=this.el(`#filter-${branch}-label`)
      label.textContent=branch==='c'&&this.state.showAll
        ? `showing all ${count.toLocaleString()} measured sites · C ${selectionLabel(model,selection)} paused`
        : `${selectionLabel(model,selection)} · ${count.toLocaleString()} sites`
      label.title=label.textContent
    }
    const siteCount=this.siteKeys.size.toLocaleString(), total=this.universe.size.toLocaleString()
    const selected=this.state.showAll?`Showing all ${total} measured sites (filters paused)`
      :`${siteCount} / ${total} sites selected`
    const branches=(['a','b','c'] as const).filter(branch=>branch!=='b'||this.includeB)
      .map(branch=>`${branch.toUpperCase()}: ${selectionLabel(this.models[branch],this.state[branch])}`)
    const properties=this.properties.filter(set=>set.enabled)
      .map(set=>`${set.id}: ${set.label.slice(set.id.length+1).replaceAll('_',' ')}`)
    const summary=this.el('#filter-summary')
    summary.textContent=`${selected} · ${[...branches,...properties].join(' · ')}`
    summary.title=summary.textContent
    this.el('#filter-b-control').hidden=this.el('#filter-b-card').hidden=!this.includeB
    this.el('#filter-upset-panel').classList.toggle('stats-only',!this.includeB)
    for (const control of this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      '#fdr-cutoff, #effect-cutoff, #estimate-type, #exposure-filter, #region-filter, #gsea-fdr, #leading-edge-only')) {
      control.disabled=this.state.showAll
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-filter-branch]')) {
      const branch=button.dataset.filterBranch as 'a'|'b'
      button.disabled=this.state.showAll || (branch==='b'&&!this.enrichmentReady&&button.dataset.filterMode!=='off')
      button.setAttribute('aria-pressed',String(this.state[branch].kind===button.dataset.filterMode))
    }
    const clear=this.el<HTMLButtonElement>('#clear-c')
    clear.hidden=this.state.c.kind==='all'
    clear.disabled=this.state.showAll
    this.el('#filter-upset-panel').classList.toggle('filters-paused',this.state.showAll)
    if (this.includeB&&!this.enrichmentReady) this.el('#filter-b-count').textContent=this.enrichmentStatus
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
        for (const branch of ['a','b','c'] as const) {
          if (branch==='b'&&!this.includeB) continue
          const source=branch==='c'?relevantCombinedIntersections(this.models.c):this.models[branch]
          let degree=0, page=0
          if (branch!=='c') {
            const searched=branch==='b'?rankedUpSetDisplay(source,0,this.sequenceMatches):source
            const degrees=intersectionDegrees(searched,this.state[branch],this.plots[branch].mode)
            if (this.degrees[branch] && !degrees.includes(this.degrees[branch])) {
              this.degrees[branch]=0; this.pages[branch]=0
            }
            degree=this.degrees[branch]
          }
          const model=branch==='b'?rankedUpSetDisplay(source,degree,this.sequenceMatches):source
          const displayed=displayedUpSet(model,this.state[branch],this.plots[branch].mode,degree)
          const activeSets=model.sets.filter(s=>s.enabled).length
          const hasSelection=['set','intersection'].includes(this.state[branch].kind)
          const focused=this.plots[branch].mode==='selected' && hasSelection
          this.el(`#filter-${branch}-count`).textContent=branch==='b'&&!this.enrichmentReady?this.enrichmentStatus:
            `${activeSets} active set${activeSets===1?'':'s'}${focused?` · ${displayed.sets.length} rows / ${displayed.intersections.length} columns shown`:branch==='c'?` · ${displayed.intersections.length} shown`:''}${branch==='b'&&this.sequenceMatches!==null?` · ${this.sequenceMatches.size} found`:''}`
          if (branch!=='c') {
            const degrees=intersectionDegrees(model,this.state[branch],this.plots[branch].mode)
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
          await this.plots[branch].render(model,this.state[branch],page,branch==='a',degree,this.state.showAll)
        }
      }
    } catch(error) {this.error(error instanceof Error?error.message:String(error))}
    finally {this.rendering=false}
  }
}
