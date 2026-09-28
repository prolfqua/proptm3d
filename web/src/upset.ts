import type { FigureSpec } from './charts.js'
import { isSignificant } from './summary.js'
import type { SiteIndexRow, Thresholds } from './types.js'

export interface UpSetIntersection {
  key: string
  contrastIndexes: number[]
  contrasts: string[]
  siteKeys: ReadonlySet<string>
  sitesByProtein: ReadonlyMap<string, readonly string[]>
  siteCount: number
  proteinCount: number
}

export interface UpSetModel {
  contrasts: string[]
  setSizes: number[]
  intersections: UpSetIntersection[]
}

export function contrastsForIntersection(
  contrasts: readonly string[],
  intersection: UpSetIntersection | null,
): string[] {
  return intersection ? [...intersection.contrasts] : [...contrasts]
}

interface SiteMembership {
  proteinId: string
  site: string
  contrasts: Set<number>
}

interface MutableIntersection {
  contrastIndexes: number[]
  siteKeys: Set<string>
  sitesByProtein: Map<string, Set<string>>
}

const COLORS = {
  ink: '#24354b',
  muted: '#68788b',
  grid: '#e4eaf0',
  inactive: '#dfe4e9',
  selected: '#1f4f82',
} as const

export function siteIdentity(proteinId: string, site: string): string {
  return `${proteinId}\u0000${site}`
}

/** Build exact significant-site intersections in manifest contrast order. */
export function computeUpSet(
  rows: readonly SiteIndexRow[],
  contrasts: readonly string[],
  thresholds: Thresholds,
): UpSetModel {
  const contrastIndex = new Map(contrasts.map((contrast, index) => [contrast, index]))
  const sites = new Map<string, SiteMembership>()
  for (const row of rows) {
    if (!isSignificant(row, thresholds)) continue
    const index = contrastIndex.get(row.contrast)
    if (index === undefined) continue
    const key = siteIdentity(row.protein_Id, row.site)
    let membership = sites.get(key)
    if (!membership) {
      membership = { proteinId: row.protein_Id, site: row.site, contrasts: new Set() }
      sites.set(key, membership)
    }
    membership.contrasts.add(index)
  }

  const setSizes = contrasts.map(() => 0)
  const intersections = new Map<string, MutableIntersection>()
  for (const [siteKey, membership] of sites) {
    const indexes = [...membership.contrasts].sort((left, right) => left - right)
    for (const index of indexes) setSizes[index] += 1
    const key = indexes.join(',')
    let intersection = intersections.get(key)
    if (!intersection) {
      intersection = { contrastIndexes: indexes, siteKeys: new Set(), sitesByProtein: new Map() }
      intersections.set(key, intersection)
    }
    intersection.siteKeys.add(siteKey)
    let proteinSites = intersection.sitesByProtein.get(membership.proteinId)
    if (!proteinSites) {
      proteinSites = new Set()
      intersection.sitesByProtein.set(membership.proteinId, proteinSites)
    }
    proteinSites.add(membership.site)
  }

  const exact = [...intersections.entries()].map(([key, intersection]): UpSetIntersection => {
    const sitesByProtein = new Map([...intersection.sitesByProtein].map(([proteinId, proteinSites]) => [
      proteinId,
      [...proteinSites].sort((left, right) => left.localeCompare(right)),
    ]))
    return {
      key,
      contrastIndexes: intersection.contrastIndexes,
      contrasts: intersection.contrastIndexes.map((index) => contrasts[index]),
      siteKeys: intersection.siteKeys,
      sitesByProtein,
      siteCount: intersection.siteKeys.size,
      proteinCount: sitesByProtein.size,
    }
  }).sort((left, right) => right.siteCount - left.siteCount || left.key.localeCompare(right.key))

  return { contrasts: [...contrasts], setSizes, intersections: exact }
}

/** Keep every contrast row for the site identities in an exact intersection. */
export function rowsForIntersection<T extends Pick<SiteIndexRow, 'protein_Id' | 'site'>>(
  rows: readonly T[],
  intersection: UpSetIntersection,
): T[] {
  return rows.filter((row) => intersection.siteKeys.has(siteIdentity(row.protein_Id, row.site)))
}

function intersectionLabel(intersection: UpSetIntersection): string {
  return `${intersection.contrasts.join(' ∩ ')}<br>`
    + `${intersection.siteCount.toLocaleString()} sites · ${intersection.proteinCount.toLocaleString()} proteins`
}

/** Build a standard UpSet layout with clickable bars and matrix dots. */
export function buildUpSetFigure(model: UpSetModel, selectedKey: string | null): FigureSpec {
  const columns = model.intersections.map((_intersection, index) => index)
  const backgroundX: number[] = []
  const backgroundY: number[] = []
  const backgroundKeys: string[] = []
  const memberX: number[] = []
  const memberY: number[] = []
  const memberKeys: string[] = []
  const memberText: string[] = []
  const shapes: Record<string, unknown>[] = []

  for (const [column, intersection] of model.intersections.entries()) {
    for (let contrast = 0; contrast < model.contrasts.length; contrast += 1) {
      backgroundX.push(column)
      backgroundY.push(contrast)
      backgroundKeys.push(intersection.key)
    }
    const color = intersection.key === selectedKey ? COLORS.selected : COLORS.ink
    const label = intersectionLabel(intersection)
    for (const contrast of intersection.contrastIndexes) {
      memberX.push(column)
      memberY.push(contrast)
      memberKeys.push(intersection.key)
      memberText.push(label)
    }
    if (intersection.contrastIndexes.length > 1) {
      shapes.push({
        type: 'line', xref: 'x2', yref: 'y2', x0: column, x1: column,
        y0: intersection.contrastIndexes[0],
        y1: intersection.contrastIndexes[intersection.contrastIndexes.length - 1],
        line: { color, width: 2 },
      })
    }
  }

  const range: [number, number] = [-0.6, Math.max(model.intersections.length - 0.4, 0.4)]
  const matrixRange: [number, number] = [model.contrasts.length - 0.5, -0.5]
  return {
    data: [
      {
        type: 'bar', name: 'Intersection sites', x: columns,
        y: model.intersections.map((intersection) => intersection.siteCount),
        customdata: model.intersections.map((intersection) => intersection.key),
        text: model.intersections.map((intersection) => intersection.siteCount.toLocaleString()),
        textposition: 'outside', cliponaxis: false,
        marker: {
          color: model.intersections.map((intersection) =>
            intersection.key === selectedKey ? COLORS.selected : COLORS.ink),
        },
        hovertext: model.intersections.map(intersectionLabel),
        hovertemplate: '%{hovertext}<extra></extra>',
        xaxis: 'x', yaxis: 'y',
      },
      {
        type: 'bar', name: 'Set sizes', orientation: 'h',
        x: model.setSizes, y: model.contrasts.map((_contrast, index) => index),
        marker: { color: COLORS.ink },
        text: model.setSizes.map((size) => size.toLocaleString()), textposition: 'inside',
        insidetextanchor: 'end', textfont: { color: '#ffffff' },
        hovertext: model.contrasts,
        hovertemplate: '%{hovertext}: %{x} significant sites<extra></extra>',
        xaxis: 'x3', yaxis: 'y3',
      },
      {
        type: 'scatter', mode: 'markers', name: 'Intersection matrix',
        x: backgroundX, y: backgroundY, customdata: backgroundKeys,
        marker: { color: COLORS.inactive, size: 10 }, hoverinfo: 'skip',
        xaxis: 'x2', yaxis: 'y2',
      },
      {
        type: 'scatter', mode: 'markers', name: 'Membership',
        x: memberX, y: memberY, customdata: memberKeys, text: memberText,
        marker: {
          color: memberKeys.map((key) => key === selectedKey ? COLORS.selected : COLORS.ink),
          size: 11,
        },
        hovertemplate: '%{text}<extra></extra>',
        xaxis: 'x2', yaxis: 'y2',
      },
    ],
    layout: {
      height: Math.max(360, 260 + model.contrasts.length * 30),
      margin: { l: 20, r: 24, t: 36, b: 24 },
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'Inter, ui-sans-serif, system-ui, sans-serif', size: 11, color: COLORS.ink },
      showlegend: false, hovermode: 'closest', bargap: 0.28, shapes,
      annotations: model.contrasts.map((contrast, index) => ({
        xref: 'paper', x: 0.205, xanchor: 'left', yref: 'y2', y: index, yanchor: 'middle',
        text: contrast, showarrow: false, font: { size: 11, color: COLORS.ink },
      })),
      xaxis: { domain: [0.4, 1], range, showgrid: false, zeroline: false, showticklabels: false },
      yaxis: {
        domain: [0.48, 1], title: { text: 'Intersection size' }, rangemode: 'tozero',
        gridcolor: COLORS.grid, zeroline: false,
      },
      xaxis2: { domain: [0.4, 1], range, showgrid: false, zeroline: false, showticklabels: false },
      yaxis2: { domain: [0, 0.34], range: matrixRange, showgrid: false, zeroline: false, showticklabels: false },
      xaxis3: {
        domain: [0, 0.18], title: { text: 'Set size' }, autorange: 'reversed',
        showgrid: false, zeroline: false,
      },
      yaxis3: {
        domain: [0, 0.34], range: matrixRange, showticklabels: false, showgrid: false, zeroline: false,
      },
    },
  }
}

export async function renderUpSet(
  element: HTMLDivElement,
  figure: FigureSpec,
  onIntersectionClick: (key: string) => void,
): Promise<void> {
  const Plotly = (await import('plotly.js-cartesian-dist-min')).default
  const graph = await Plotly.react(
    element,
    figure.data,
    figure.layout,
    {
      responsive: true,
      displaylogo: false,
      displayModeBar: false,
      modeBarButtonsToRemove: ['sendChartToCloud'],
    },
  )
  graph.removeAllListeners('plotly_click')
  graph.on('plotly_click', (event) => {
    const key = event.points[0]?.customdata
    if (typeof key === 'string') onIntersectionClick(key)
  })
}
