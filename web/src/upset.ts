import type { FigureSpec } from './charts.js'

export interface SiteSet {
  id: string
  label: string
  siteKeys: ReadonlySet<string>
  enabled: boolean
}
export type SetSelection = { kind: 'off' | 'all' }
  | { kind: 'set'; id: string }
  | { kind: 'intersection'; ids: readonly string[] }
export type UpSetViewMode = 'selected' | 'all'
export interface UpSetIntersection {
  key: string
  setIds: string[]
  siteKeys: ReadonlySet<string>
}
export interface UpSetModel {
  sets: readonly SiteSet[]
  union: ReadonlySet<string>
  intersections: UpSetIntersection[]
}
export const UPSET_PAGE_SIZE = 50
export const siteIdentity = (proteinId: string, site: string): string => `${proteinId}\u0000${site}`
export const intersectionKey = (ids: readonly string[]): string => JSON.stringify([...ids].sort())

/** Partition the union, not its power set; disabled filters contribute nothing. */
export function computeUpSet(sets: readonly SiteSet[]): UpSetModel {
  const members = new Map<string, string[]>()
  for (const set of sets) {
    if (!set.enabled) continue
    for (const site of set.siteKeys) {
      const ids = members.get(site) ?? []
      ids.push(set.id)
      members.set(site, ids)
    }
  }
  const groups = new Map<string, { key: string; setIds: string[]; siteKeys: Set<string> }>()
  for (const [site, ids] of members) {
    const key = intersectionKey(ids)
    if (!groups.has(key)) groups.set(key, { key, setIds: ids, siteKeys: new Set() })
    groups.get(key)!.siteKeys.add(site)
  }
  return { sets, union: new Set(members.keys()), intersections: [...groups.values()]
    .sort((a, b) => b.siteKeys.size - a.siteKeys.size || a.key.localeCompare(b.key)) }
}

/** null means disabled, whereas an empty set means enabled with no matching sites. */
export function resolveSelection(model: UpSetModel, selection: SetSelection): ReadonlySet<string> | null {
  if (selection.kind === 'off') return null
  if (selection.kind === 'all') return model.union
  if (selection.kind === 'set') return model.sets.find(s => s.id === selection.id)?.siteKeys ?? new Set()
  if (selection.kind === 'intersection') {
    return model.intersections.find(s => s.key === intersectionKey(selection.ids))?.siteKeys ?? new Set()
  }
  return new Set()
}

export function selectionLabel(model: UpSetModel, selection: SetSelection): string {
  const label = (id: string) => model.sets.find(s => s.id === id)?.label ?? id
  if (selection.kind === 'set') return label(selection.id)
  if (selection.kind === 'intersection') return selection.ids.map(label).join(' ∩ ') + ' (exact)'
  return selection.kind
}

export function rowsForSites<T extends { protein_Id: string; site: string }>(
  rows: readonly T[], keys: ReadonlySet<string>,
): T[] {
  return rows.filter(row => keys.has(siteIdentity(row.protein_Id, row.site)))
}

const ink = '#24354b', selected = '#1f4f82', inactive = '#dfe4e9'
export function intersectionDegrees(model: UpSetModel, selection: SetSelection = {kind:'all'},
  mode: UpSetViewMode = 'all'): number[] {
  return [...new Set(displayedUpSet(model,selection,mode).intersections.map(group=>group.setIds.length))]
    .sort((a,b)=>a-b)
}

/** Display only: exact combinations are still computed over every enabled set. */
export function intersectionsAtDegree(model: UpSetModel, degree: number): UpSetIntersection[] {
  return degree ? model.intersections.filter(group=>group.setIds.length===degree) : model.intersections
}

/** Display focus changes plotted counts, never the full model or exact-membership identities. */
export function displayedUpSet(model: UpSetModel, selection: SetSelection, mode: UpSetViewMode, degree = 0):
  {sets: readonly SiteSet[]; intersections: UpSetIntersection[]; setSizes: ReadonlyMap<string, number> | null} {
  const intersections = (groups: UpSetIntersection[]) => degree
    ? groups.filter(group=>group.setIds.length===degree) : groups
  if (mode === 'selected' && selection.kind === 'set') {
    const groups=intersections(model.intersections.filter(group=>group.setIds.includes(selection.id)))
    const setSizes=new Map<string, number>()
    for (const group of groups) {
      for (const id of group.setIds) setSizes.set(id,(setSizes.get(id)??0)+group.siteKeys.size)
    }
    const sets=model.sets.filter(set=>(setSizes.get(set.id)??0)>0).sort((a,b)=>
      Number(b.id===selection.id)-Number(a.id===selection.id)
      || (setSizes.get(b.id)??0)-(setSizes.get(a.id)??0) || a.id.localeCompare(b.id))
    return {sets,intersections:groups,setSizes}
  }
  if (mode === 'selected' && selection.kind === 'intersection') {
    return {sets:model.sets.filter(set=>selection.ids.includes(set.id)), intersections:intersections(model.intersections),setSizes:null}
  }
  return {sets:model.sets, intersections:intersections(model.intersections),setSizes:null}
}

/** Search and row ordering affect the UpSet display, never its exact site memberships. */
export function rankedUpSetDisplay(model: UpSetModel, degree: number, matches: ReadonlySet<string> | null): UpSetModel {
  const intersections = matches === null ? model.intersections
    : model.intersections.filter(group=>group.setIds.some(id=>matches.has(id)))
  const scores = new Map<string,{largest:number,total:number}>()
  for (const group of intersections) {
    if (degree && group.setIds.length!==degree) continue
    for (const id of group.setIds) {
      const score=scores.get(id)??{largest:0,total:0}
      score.largest=Math.max(score.largest,group.siteKeys.size)
      score.total+=group.siteKeys.size
      scores.set(id,score)
    }
  }
  const sets=[...model.sets].sort((a,b)=>{
    const match=(matches?.has(b.id)?1:0)-(matches?.has(a.id)?1:0)
    if (match) return match
    if (degree) {
      const largest=(scores.get(b.id)?.largest??0)-(scores.get(a.id)?.largest??0)
      if (largest) return largest
      const total=(scores.get(b.id)?.total??0)-(scores.get(a.id)?.total??0)
      if (total) return total
    }
    return b.siteKeys.size-a.siteKeys.size || a.id.localeCompare(b.id)
  })
  return {...model,sets,intersections}
}

/** Same renderer for A, B and C. Dot count and paging never change the membership universe. */
export function buildUpSetFigure(model: UpSetModel, selection: SetSelection, page = 0, sortRows = true, degree = 0,
  mode: UpSetViewMode = 'all'): FigureSpec {
  const displayed = displayedUpSet(model,selection,mode,degree)
  const sets = sortRows && !displayed.setSizes
    ? [...displayed.sets].sort((a,b)=>b.siteKeys.size-a.siteKeys.size || a.id.localeCompare(b.id)) : displayed.sets
  const intersections = displayed.intersections.slice(page * UPSET_PAGE_SIZE, (page + 1) * UPSET_PAGE_SIZE)
  const sizes=sets.map(set=>displayed.setSizes?.get(set.id)??set.siteKeys.size)
  const columns = intersections.map((_, i) => i)
  const key = selection.kind === 'intersection' ? intersectionKey(selection.ids) : null
  const backgroundX: number[] = [], backgroundY: number[] = [], backgroundData: SetSelection[] = []
  const memberX: number[] = [], memberY: number[] = [], memberData: SetSelection[] = []
  const shapes: Record<string, unknown>[] = []
  for (const [x, group] of intersections.entries()) {
    const click: SetSelection = {kind: 'intersection', ids: group.setIds}
    const indexes = sets.flatMap((set, y) => {
      if (!set.enabled) return []
      backgroundX.push(x); backgroundY.push(y); backgroundData.push(click)
      if (!group.setIds.includes(set.id)) return []
      memberX.push(x); memberY.push(y); memberData.push(click)
      return [y]
    })
    if (indexes.length > 1) shapes.push({type:'line', xref:'x2', yref:'y2', x0:x, x1:x,
      y0:indexes[0], y1:indexes.at(-1), line:{color:group.key===key?selected:ink, width:2}})
  }
  const height = Math.max(360, 220 + sets.length * 26)
  const plotHeight = height - 55, matrixTop = 1 - 180 / plotHeight
  const range = [-.6, Math.max(.6, intersections.length - .4)]
  const matrixRange = [sets.length - .5, -.5]
  return {data: [
    {type:'bar', name:'Intersection sites', x:columns, y:intersections.map(g=>g.siteKeys.size),
      customdata:intersections.map(g=>({kind:'intersection',ids:g.setIds})),
      text:intersections.map(g=>g.siteKeys.size.toLocaleString()), textposition:'outside', cliponaxis:false,
      marker:{color:intersections.map(g=>g.key===key?selected:ink)},
      hovertext:intersections.map(g=>selectionLabel(model,{kind:'intersection',ids:g.setIds})),
      hovertemplate:'%{hovertext}<br>%{y} sites<extra></extra>', xaxis:'x', yaxis:'y'},
    {type:'bar', name:displayed.setSizes?'Overlap sizes':'Set sizes', orientation:'h', x:sets.map((s,i)=>s.enabled?sizes[i]:0),
      y:sets.map((_,i)=>i), customdata:sets.map(s=>s.enabled?{kind:'set',id:s.id}:null),
      marker:{color:sets.map(s=>selection.kind==='set'&&selection.id===s.id?selected:ink)},
      text:sets.map((s,i)=>s.enabled?sizes[i].toLocaleString():'off'), textposition:'outside',
      textangle:0, constraintext:'none', cliponaxis:false, textfont:{color:ink,size:12}, hovertext:sets.map(s=>s.label),
      hovertemplate:'%{hovertext}: %{x} sites<extra></extra>', xaxis:'x3', yaxis:'y3'},
    {type:'scatter', mode:'markers', name:'Intersection matrix', x:backgroundX, y:backgroundY,
      customdata:backgroundData, marker:{color:inactive,size:9}, hoverinfo:'none',xaxis:'x2',yaxis:'y2'},
    {type:'scatter', mode:'markers', name:'Membership',x:memberX,y:memberY,customdata:memberData,
      marker:{color:memberData.map(s=>s.kind==='intersection'&&intersectionKey(s.ids)===key?selected:ink),size:10},
      hoverinfo:'none',xaxis:'x2',yaxis:'y2'},
  ],layout:{height,margin:{l:64,r:20,t:25,b:30},paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',
    font:{family:'Inter, ui-sans-serif, system-ui, sans-serif',size:11,color:ink},showlegend:false,bargap:.28,shapes,
    annotations:[...sets.map((s,i)=>({xref:'paper',x:.17,xanchor:'left',yref:'y2',y:i,text:s.label,
      captureevents:s.enabled,showarrow:false,font:{size:11,color:s.enabled?ink:'#8995a3'}})),
      ...(!intersections.length?[{xref:'paper',yref:'paper',x:.74,y:1,showarrow:false,
        text:mode==='selected'&&selection.kind==='set'?'No intersections for the selected set in this view'
          :degree?`No intersections with ${degree} ${degree===1?'dot':'dots'}`:'No intersections'}]:[])],
    xaxis:{domain:[.48,1],range,showgrid:false,zeroline:false,showticklabels:false},
    yaxis:{domain:[matrixTop+24/plotHeight,1],title:{text:'Intersection size'},rangemode:'tozero',gridcolor:'#e4eaf0',zeroline:false},
    xaxis2:{anchor:'y2',domain:[.48,1],range,showgrid:false,zeroline:false,showticklabels:false},
    yaxis2:{anchor:'x2',domain:[0,matrixTop],range:matrixRange,showgrid:false,zeroline:false,showticklabels:false},
    xaxis3:{anchor:'y3',domain:[0,.14],title:{text:displayed.setSizes?'Overlap size':'Set size'},autorange:'reversed',showgrid:false,zeroline:false},
    yaxis3:{anchor:'x3',domain:[0,matrixTop],range:matrixRange,showgrid:false,zeroline:false,showticklabels:false},
  }}
}

/** Reusable UpSet plot with its own display focus and in-plot view control. */
export class UpSetPlot {
  private viewMode: UpSetViewMode = 'selected'
  private graph: HTMLDivElement | null = null
  private buttons: Partial<Record<UpSetViewMode,HTMLButtonElement>> = {}

  constructor(private element: HTMLDivElement, private label: string,
    private onSelect: (selection: SetSelection) => void, private onViewChange: () => void) {}

  get mode(): UpSetViewMode { return this.viewMode }

  setView(mode: UpSetViewMode): void {
    if (this.viewMode===mode) return
    this.viewMode=mode
    this.onViewChange()
  }

  focusSelection(): void { this.viewMode='selected' }

  private mount(): HTMLDivElement {
    if (this.graph) return this.graph
    const graph=document.createElement('div')
    graph.className='upset-graph'
    const toolbar=document.createElement('div')
    toolbar.className='upset-plot-toolbar'
    toolbar.setAttribute('role','group')
    toolbar.setAttribute('aria-label',this.label)
    const title=document.createElement('span')
    title.textContent='View'
    toolbar.append(title)
    for (const mode of ['selected','all'] as const) {
      const button=document.createElement('button')
      button.type='button'
      button.textContent=mode==='selected'?'Selected':'All'
      button.onclick=()=>this.setView(mode)
      this.buttons[mode]=button
      toolbar.append(button)
    }
    this.element.replaceChildren(toolbar,graph)
    this.graph=graph
    return graph
  }

  async render(model: UpSetModel, selection: SetSelection, page: number, sortRows: boolean,
    degree: number, paused: boolean): Promise<void> {
    const graph=this.mount()
    const hasSelection=selection.kind==='set'||selection.kind==='intersection'
    const effectiveMode=hasSelection?this.viewMode:'all'
    for (const mode of ['selected','all'] as const) {
      const button=this.buttons[mode]!
      button.disabled=paused || (mode==='selected'&&!hasSelection)
      button.setAttribute('aria-pressed',String(effectiveMode===mode))
    }
    const figure=buildUpSetFigure(model,selection,page,sortRows,degree,this.viewMode)
    this.element.style.height=`${figure.layout.height}px`
    await renderUpSet(graph,figure,choice=>{
      this.focusSelection()
      this.onSelect(choice)
    })
  }
}

async function renderUpSet(element: HTMLDivElement, figure: FigureSpec,
  onClick: (selection: SetSelection) => void): Promise<void> {
  // Plotly's responsive container uses 100% height after resize; anchor it to the row-aware figure height.
  element.style.height = `${figure.layout.height}px`
  const Plotly = (await import('plotly.js-cartesian-dist-min')).default
  const graph = await Plotly.react(element, figure.data, figure.layout,
    {responsive:true,displaylogo:false,displayModeBar:false,modeBarButtonsToRemove:['sendChartToCloud']})
  graph.removeAllListeners('plotly_click')
  graph.on('plotly_click', event => {
    const selection = event.points[0]?.customdata as SetSelection | undefined
    if (selection?.kind === 'set' || selection?.kind === 'intersection') onClick(selection)
  })
  // Expose the same chart choices to keyboard users, without a second selector/model.
  element.querySelectorAll('.barlayer .trace').forEach((trace, index) => {
    const choices = figure.data[index].customdata as Array<SetSelection | null>
    const labels = figure.data[index].hovertext as string[]
    trace.querySelectorAll<SVGElement>('.point').forEach((point, i) => {
      const choice = choices[i]
      if (!choice) return
      point.setAttribute('role', 'button')
      point.setAttribute('tabindex', '0')
      point.setAttribute('aria-label', `${choice.kind === 'set' ? 'Whole set' : 'Exact intersection'}: ${labels[i]}`)
      point.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(choice) }
      }
      // Plotly disables pointer events on bar text, so outside count labels miss its bar picker.
      const count = point.querySelector<SVGTextElement>('.bartext')
      if (count) {
        count.style.pointerEvents = 'all'
        count.style.cursor = 'pointer'
        count.onclick = event => { event.stopPropagation(); onClick(choice) }
      }
    })
  })
  const sets = figure.data[1].customdata as Array<SetSelection | null>
  const labels = figure.data[1].hovertext as string[]
  element.querySelectorAll<SVGGElement>('.annotation[data-index]').forEach(annotation => {
    const index = Number(annotation.dataset.index)
    const choice = sets[index]
    if (choice?.kind !== 'set') return
    annotation.setAttribute('role', 'button')
    annotation.setAttribute('tabindex', '0')
    annotation.setAttribute('aria-label', `Whole set: ${labels[index]}`)
    annotation.style.cursor = 'pointer'
    annotation.onclick = event => { event.stopPropagation(); onClick(choice) }
    annotation.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(choice) }
    }
  })
}
