import type { FigureSpec } from './charts.js'
import type { GseaPayload, GseaSequenceSet } from './types.js'

export interface SiteIdentity {
  protein_Id: string
  site: string
}

export function sequenceSetKey(source: string, sequenceSet: string): string {
  return `${source}\u0000${sequenceSet}`
}

export function sequenceSetsAtFdr(payload: GseaPayload, fdr: number): GseaSequenceSet[] {
  return payload.sequenceSets
    .filter((row) => Number.isFinite(row.fdr) && row.fdr < fdr)
    .sort((left, right) => left.fdr - right.fdr || Math.abs(right.nes) - Math.abs(left.nes))
}

export function selectedSequenceSet(
  payload: GseaPayload,
  key: string,
): GseaSequenceSet | null {
  return payload.sequenceSets.find(
    (row) => sequenceSetKey(row.source, row.sequence_set) === key,
  ) ?? null
}

export function gseaSiteKeys(
  payload: GseaPayload,
  selectedKey: string,
  leadingEdgeOnly: boolean,
): Set<string> {
  const selected = selectedSequenceSet(payload, selectedKey)
  if (!selected) return new Set()
  return new Set(payload.memberships
    .filter((row) => row.source === selected.source
      && row.sequence_set === selected.sequence_set
      && (!leadingEdgeOnly || row.is_leading_edge))
    .map((row) => `${row.protein_Id}\u0000${row.site}`))
}

export function filterSitesByGsea<T extends SiteIdentity>(
  rows: readonly T[],
  payload: GseaPayload,
  selectedKey: string,
  leadingEdgeOnly: boolean,
): T[] {
  const keys = gseaSiteKeys(payload, selectedKey, leadingEdgeOnly)
  return rows.filter((row) => keys.has(`${row.protein_Id}\u0000${row.site}`))
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
  selectedKey: string,
): FigureSpec {
  const selected = selectedSequenceSet(payload, selectedKey)
  const regular = payload.sequenceSets.filter((row) => row !== selected)
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
  if (selected) data.push(trace([selected], 'Selected sequence set', '#ad3a2b', 12))
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
): FigureSpec | null {
  const selected = selectedSequenceSet(payload, selectedKey)
  if (!selected) return null
  const curve = payload.curves.find((row) => row.source === selected.source
    && row.sequence_set === selected.sequence_set)
  if (!curve || curve.running_scores.length === 0) return null
  const extremeScore = selected.nes >= 0
    ? Math.max(...curve.running_scores)
    : Math.min(...curve.running_scores)
  const extremeRank = curve.rank_indices[curve.running_scores.indexOf(extremeScore)]
  const leading = curve.hit_indices.map((rank, index) => ({ rank, score: curve.hit_scores[index] }))
    .filter((hit) => selected.nes >= 0 ? hit.rank <= extremeRank : hit.rank >= extremeRank)
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
        marker: { color: '#8d99a6', size: 7, symbol: 'line-ns-open' },
        hovertemplate: 'Hit at rank %{x}<br>Running score %{y:.3f}<extra></extra>',
      },
      {
        type: 'scatter', mode: 'markers', name: 'Leading edge',
        x: leading.map((hit) => hit.rank), y: leading.map((hit) => hit.score),
        marker: { color: '#ad3a2b', size: 8, symbol: 'line-ns-open' },
        hovertemplate: 'Leading-edge hit at rank %{x}<br>Running score %{y:.3f}<extra></extra>',
      },
    ],
    layout: plotLayout(
      `${selected.sequence_set} · NES ${selected.nes.toFixed(2)} · FDR ${selected.fdr.toPrecision(3)}`,
      'Ranked sequence window',
      'Running enrichment score',
    ),
  }
}
