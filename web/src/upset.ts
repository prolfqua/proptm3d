import type { FigureSpec } from './charts.js'
import { displayedUpSet, intersectionKey, selectionLabel, UPSET_PAGE_SIZE, type SetSelection,
  type UpSetModel, type UpSetViewMode } from './upset-model.js'

const ink = '#24354b', selected = '#1f4f82', inactive = '#dfe4e9'

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
