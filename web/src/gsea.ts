import { rowsForSites, siteIdentity, type SetSelection } from './upset-model.js'
import type { FigureSpec } from './charts.js'
import type { AppData, GseaMembership, GseaPayload, GseaResultManifest, GseaSequenceSet,
  RunManifest } from './types.js'

export function availableEnrichmentScopes(run: RunManifest, allowed: readonly string[]):
  Array<{result:GseaResultManifest; contrasts:string[]}> {
  const permitted=new Set(allowed)
  return (run.gsea?.results??[]).map(result=>({result,
    contrasts:run.contrasts.filter(contrast=>permitted.has(contrast)&&Boolean(result.contrasts[contrast])),
  })).filter(scope=>scope.contrasts.length>0)
}

/** Preserve the current single-contrast context when possible, otherwise choose the first permitted one. */
export function resolveEnrichmentContext(run: RunManifest, allowed: readonly string[],
  currentResult: string, currentContrast: string) {
  const scopes=availableEnrichmentScopes(run,allowed)
  const chosen=scopes.find(({result})=>result.id===currentResult)??scopes[0]
  const contrasts=chosen?.contrasts??[]
  return {scopes,contrasts,resultId:chosen?.result.id??'',
    contrast:contrasts.includes(currentContrast)?currentContrast:contrasts[0]??''}
}

export function sequenceSetKey(source: string, sequenceSet: string): string {
  return `${source}\u0000${sequenceSet}`
}

export function sequenceSetsAtFdr(payload: GseaPayload, fdr: number): GseaSequenceSet[] {
  return payload.sequenceSets
    .filter((row) => Number.isFinite(row.fdr) && row.fdr < fdr)
    .sort((left, right) => left.fdr - right.fdr || Math.abs(right.nes) - Math.abs(left.nes))
}

/** A display choice is available only when the set contains a site in the effective filter result. */
export function navigableSequenceSets(payload: GseaPayload, sites: ReadonlySet<string>): GseaSequenceSet[] {
  const available=new Set(payload.memberships.filter(row=>sites.has(siteIdentity(row.protein_Id,row.site)))
    .map(row=>sequenceSetKey(row.source,row.sequence_set)))
  return payload.sequenceSets.filter(row=>available.has(sequenceSetKey(row.source,row.sequence_set)))
    .sort((a,b)=>a.fdr-b.fdr || Math.abs(b.nes)-Math.abs(a.nes))
}

/** B determines the visible enrichment rows and highlights; one curve remains a display focus. */
export function gseaSelectionView(payload: GseaPayload, fdr: number, selection: SetSelection,
): {rows:GseaSequenceSet[]; highlighted:ReadonlySet<string>} {
  const eligible=sequenceSetsAtFdr(payload,fdr)
  const selected=selection.kind==='set'?[selection.id]
    :selection.kind==='intersection'?selection.ids:[]
  const selectedKeys=new Set(selected)
  const rows=selected.length ? eligible.filter(row=>selectedKeys.has(sequenceSetKey(row.source,row.sequence_set)))
    :eligible
  const highlighted=new Set(selected.length?rows.map(row=>sequenceSetKey(row.source,row.sequence_set)):[])
  return {rows,highlighted}
}

/** Upper curve choices are the B-filtered sequence sets that still meet the effective site selection. */
export function gseaNavigationRows(payload: GseaPayload, fdr: number, selection: SetSelection,
  sites: ReadonlySet<string>): GseaSequenceSet[] {
  const eligible=new Set(gseaSelectionView(payload,fdr,selection).rows
    .map(row=>sequenceSetKey(row.source,row.sequence_set)))
  return navigableSequenceSets(payload,sites)
    .filter(row=>eligible.has(sequenceSetKey(row.source,row.sequence_set)))
}

export function selectedSequenceSet(
  payload: GseaPayload,
  key: string,
): GseaSequenceSet | null {
  return payload.sequenceSets.find(
    (row) => sequenceSetKey(row.source, row.sequence_set) === key,
  ) ?? null
}

export function membershipKey(row: GseaMembership): string {
  return `${row.protein_Id}\u0000${row.site}\u0000${row.rank}`
}

export function selectedMemberships(
  payload: GseaPayload,
  selectedKey: string,
  leadingEdgeOnly: boolean,
): GseaMembership[] {
  const selected = selectedSequenceSet(payload, selectedKey)
  if (!selected) return []
  return payload.memberships
    .filter((row) => row.source === selected.source
      && row.sequence_set === selected.sequence_set
      && (!leadingEdgeOnly || row.is_leading_edge))
    .sort((left, right) => left.rank - right.rank
      || left.protein_Id.localeCompare(right.protein_Id)
      || left.site.localeCompare(right.site))
}

function plotLayout(title: string, xTitle: string, yTitle: string): Record<string, unknown> {
  return {
    title: { text: title, x: 0, xanchor: 'left', font: { size: 15, color: '#24354b' } },
    height: 390,
    margin: { l: 72, r: 28, t: 58, b: 62 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Inter, ui-sans-serif, system-ui, sans-serif', size: 12, color: '#24354b' },
    hovermode: 'closest',
    showlegend: false,
    xaxis: { title: { text: xTitle }, gridcolor: '#e4eaf0', zerolinecolor: '#44546b' },
    yaxis: { title: { text: yTitle }, gridcolor: '#e4eaf0', zerolinecolor: '#44546b' },
  }
}

export function buildGseaVolcanoFigure(
  payload: GseaPayload,
  fdr: number,
  highlightedKeys: ReadonlySet<string>,
): FigureSpec {
  const selected = payload.sequenceSets.filter(row=>highlightedKeys.has(sequenceSetKey(row.source,row.sequence_set)))
  const regular = payload.sequenceSets.filter(row=>!highlightedKeys.has(sequenceSetKey(row.source,row.sequence_set)))
  const point = (row: GseaSequenceSet) => [
    sequenceSetKey(row.source, row.sequence_set), row.source, row.sequence_set,
    row.description, row.nes, row.fdr,
  ]
  const trace = (rows: GseaSequenceSet[], name: string, color: string, size: number) => ({
    type: 'scattergl', mode: 'markers', name,
    x: rows.map((row) => row.nes),
    y: rows.map((row) => -Math.log10(Math.max(row.fdr, 1e-300))),
    customdata: rows.map(point),
    marker: { color, size, opacity: 0.88, line: { color: '#ffffff', width: 0.8 } },
    hovertemplate: '<b>%{customdata[2]}</b><br>%{customdata[3]}<br>'
      + 'Source: %{customdata[1]}<br>NES: %{x:.3f}<br>FDR: %{customdata[5]:.3g}<extra></extra>',
  })
  const passing = regular.filter((row) => row.fdr < fdr)
  const other = regular.filter((row) => row.fdr >= fdr)
  const data = [
    trace(other, 'Above GSEA FDR', '#aeb7c2', 7),
    trace(passing, 'Below GSEA FDR', '#356b9a', 8),
  ]
  if (selected.length) data.push(trace(selected, 'B-selected sequence sets', '#ad3a2b', 12))
  const layout = plotLayout(
    `${payload.result.label} · ${payload.contrast}`,
    'Normalized enrichment score',
    '−log10(GSEA FDR)',
  )
  layout.shapes = [{
    type: 'line', xref: 'paper', x0: 0, x1: 1,
    y0: -Math.log10(fdr), y1: -Math.log10(fdr),
    line: { color: '#68788b', width: 1, dash: 'dot' },
  }]
  return { data, layout }
}

export function buildEnrichmentFigure(
  payload: GseaPayload,
  selectedKey: string,
  selectedSites: ReadonlySet<string> = new Set(),
): FigureSpec | null {
  const selected = selectedSequenceSet(payload, selectedKey)
  if (!selected) return null
  const curve = payload.curves.find((row) => row.source === selected.source
    && row.sequence_set === selected.sequence_set)
  if (!curve || curve.running_scores.length === 0) return null
  const memberships = selectedMemberships(payload, selectedKey, false)
  const byRank = new Map<number, GseaMembership[]>()
  for (const row of memberships) {
    const rows = byRank.get(row.rank) ?? []
    rows.push(row)
    byRank.set(row.rank, rows)
  }
  const hitData = curve.hit_indices.map((rank) => {
    const rows = byRank.get(rank) ?? []
    return [rank, rows.map((row) => `${row.protein_Id} · ${row.site}`).join(', '),
      rows.map(membershipKey)]
  })
  const leadingRanks = new Set(memberships
    .filter((row) => row.is_leading_edge).map((row) => row.rank))
  const leading = curve.hit_indices.map((rank, index) => ({
    rank, score: curve.hit_scores[index], customdata: hitData[index],
  })).filter((hit) => leadingRanks.has(hit.rank))
  const selectedHits = curve.hit_indices.map((rank,index)=>({rank,score:curve.hit_scores[index],customdata:hitData[index]}))
    .filter(hit=>(byRank.get(hit.rank)??[]).some(row=>selectedSites.has(siteIdentity(row.protein_Id,row.site))))
  return {
    data: [
      {
        type: 'scatter', mode: 'lines', name: 'Running enrichment score',
        x: curve.rank_indices, y: curve.running_scores,
        line: { color: selected.nes >= 0 ? '#ad3a2b' : '#2868a2', width: 2.2 },
        hovertemplate: 'Rank %{x}<br>Running score %{y:.3f}<extra></extra>',
      },
      {
        type: 'scatter', mode: 'markers', name: 'Set member',
        x: curve.hit_indices, y: curve.hit_scores,
        customdata: hitData,
        marker: { color: '#8d99a6', size: 7, symbol: 'line-ns-open' },
        hovertemplate: 'Hit at rank %{customdata[0]}<br>%{customdata[1]}<br>'
          + 'Running score %{y:.3f}<extra></extra>',
      },
      {
        type: 'scatter', mode: 'markers', name: 'Leading edge',
        x: leading.map((hit) => hit.rank), y: leading.map((hit) => hit.score),
        customdata: leading.map((hit) => hit.customdata),
        marker: { color: '#ad3a2b', size: 8, symbol: 'line-ns-open' },
        hovertemplate: 'Leading-edge hit at rank %{customdata[0]}<br>%{customdata[1]}<br>'
          + 'Running score %{y:.3f}<extra></extra>',
      },
      {type:'scatter',mode:'markers',name:'Selected sites',x:selectedHits.map(h=>h.rank),y:selectedHits.map(h=>h.score),
        customdata:selectedHits.map(h=>h.customdata),marker:{color:'#1f4f82',size:9,symbol:'circle-open',line:{width:2}},
        hovertemplate:'Selected hit at rank %{customdata[0]}<br>%{customdata[1]}<extra></extra>'},
    ],
    layout: plotLayout(
      `${selected.sequence_set} · NES ${selected.nes.toFixed(2)} · FDR ${selected.fdr.toPrecision(3)}`,
      'Ranked sequence window',
      'Running enrichment score',
    ),
  }
}

export interface GseaSiteTableRow {
  row_key: string
  protein_Id: string
  site: string
  gene_name: string
  accession: string
  sequence_window: string | null
  rank: number | null
  running_score: number | null
  is_leading_edge: boolean | null
  nes: number | null
  effect: number | null
  fdr: number | null
}

export function gseaSiteTableRows(
  payload: GseaPayload | null, selectedKey: string, data: AppData, contrast: string,
  selectedSites: ReadonlySet<string>, search: string,
): GseaSiteTableRow[] {
  const selected = payload ? selectedSequenceSet(payload, selectedKey) : null
  const members = new Map<string, ReturnType<typeof selectedMemberships>>()
  for (const member of payload ? selectedMemberships(payload, selectedKey, false) : []) {
    const id = siteIdentity(member.protein_Id, member.site)
    members.set(id, [...(members.get(id) ?? []), member])
  }
  const results = new Map(data.siteIndex.filter(r=>r.contrast===contrast).map(r=>[siteIdentity(r.protein_Id,r.site),r]))
  const rows = rowsForSites(data.sites, selectedSites).flatMap<GseaSiteTableRow>(site => {
    const id = siteIdentity(site.protein_Id, site.site), result = results.get(id)
    const common = {protein_Id:site.protein_Id, site:site.site, gene_name:site.gene_name, accession:site.accession,
      effect:result?.effect??null, fdr:result?.fdr??null}
    const hits = members.get(id)
    return hits?.length ? hits.map(member=>({...common,...member,row_key:membershipKey(member),nes:selected!.nes}))
      : [{...common,row_key:id,sequence_window:site.SequenceWindow,rank:null,running_score:null,is_leading_edge:null,nes:null}]
  })
  return search ? rows.filter(row=>[row.gene_name,row.accession,row.protein_Id,row.site]
    .some(value=>value.toLocaleLowerCase().includes(search))) : rows
}
