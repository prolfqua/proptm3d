import type { FigureSpec } from './charts.js'
import { servedUrl } from './served-url.js'
import type { StructureFile } from './types.js'

export interface PaeMatrix {
  size: number
  values: Uint8Array
  maxPae: number
}

const MAX_CELLS = 900
const pending = new Map<string, Promise<PaeMatrix>>()

/** Read one EBI AlphaFold PAE document: a square `predicted_aligned_error` matrix in Å. */
export function parsePae(payload: unknown): PaeMatrix {
  const record = (Array.isArray(payload) ? payload[0] : payload) as {
    predicted_aligned_error?: unknown; max_predicted_aligned_error?: unknown
  } | undefined
  if (!record) throw new Error('The PAE file is empty.')
  const rows = record.predicted_aligned_error
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('The PAE file has no predicted_aligned_error matrix.')
  const size = rows.length
  const values = new Uint8Array(size * size)
  rows.forEach((row, index) => {
    if (!Array.isArray(row) || row.length !== size) throw new Error(`The PAE matrix is not square (${size} rows).`)
    values.set(row as number[], index * size)
  })
  const maxPae = typeof record.max_predicted_aligned_error === 'number'
    ? record.max_predicted_aligned_error : values.reduce((max, value) => Math.max(max, value), 0)
  return { size, values, maxPae }
}

async function gunzip(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer)
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes)
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

/** Fetch one model's PAE only when asked for; each URL is downloaded at most once. */
export async function loadPae(url: string, baseUrl = document.baseURI): Promise<PaeMatrix> {
  const href = servedUrl(url, baseUrl).href
  let matrix = pending.get(href)
  if (!matrix) {
    matrix = (async () => {
      const response = await fetch(href, { mode: 'same-origin', redirect: 'error' })
      if (!response.ok) throw new Error(`PAE request failed (${response.status}): ${url}`)
      return parsePae(JSON.parse(await gunzip(await response.arrayBuffer())))
    })()
    matrix.catch(() => pending.delete(href))
    pending.set(href, matrix)
  }
  return matrix
}

/** The fragment displayed in 3D, or the first model before the viewer has loaded. */
export function paeModelFor(structures: readonly StructureFile[], activeFragment: number | null): StructureFile | null {
  return structures.find((model) => model.fragment === activeFragment) ?? structures[0] ?? null
}

/** Protein residue number of a 1-based model position, honouring the fragment offset. */
export function proteinPosition(model: StructureFile, modelPosition: number): number {
  return model.start + modelPosition - 1
}

/** Residues per heatmap cell; matrices above maxCells residues are shown as block means. */
export function paeBlockSize(size: number, maxCells = MAX_CELLS): number {
  return Math.ceil(size / maxCells)
}

/**
 * Rows are the residue the model is aligned on and columns the residue whose position is scored,
 * as in AlphaFold DB. Matrices above MAX_CELLS residues are shown as block means.
 */
export function buildPaeFigure(
  matrix: PaeMatrix,
  model: StructureFile,
  selectedPosition: number | null,
  proteinName: string,
  maxCells = MAX_CELLS,
): FigureSpec {
  const bin = paeBlockSize(matrix.size, maxCells)
  const cells = Math.ceil(matrix.size / bin)
  const axis = Array.from({ length: cells }, (_, cell) => proteinPosition(model, cell * bin + 1))
  const z: number[][] = []
  for (let row = 0; row < cells; row += 1) {
    const line: number[] = []
    for (let column = 0; column < cells; column += 1) {
      let sum = 0
      let count = 0
      for (let i = row * bin; i < Math.min((row + 1) * bin, matrix.size); i += 1) {
        for (let j = column * bin; j < Math.min((column + 1) * bin, matrix.size); j += 1) {
          sum += matrix.values[i * matrix.size + j]
          count += 1
        }
      }
      line.push(sum / count)
    }
    z.push(line)
  }
  const first = proteinPosition(model, 1)
  const last = proteinPosition(model, matrix.size)
  const guides = selectedPosition !== null && first <= selectedPosition && selectedPosition <= last
    ? [
        { type: 'line', x0: selectedPosition, x1: selectedPosition, y0: first, y1: last,
          line: { color: '#152d46', width: 1.4, dash: 'dot' } },
        { type: 'line', y0: selectedPosition, y1: selectedPosition, x0: first, x1: last,
          line: { color: '#152d46', width: 1.4, dash: 'dot' } },
      ]
    : []
  const binned = bin > 1 ? ` · ${bin}-residue block means` : ''
  return {
    data: [{
      type: 'heatmap', x: axis, y: axis, z, zmin: 0, zmax: matrix.maxPae,
      colorscale: [[0, '#0b4f2a'], [0.35, '#4c9a5f'], [1, '#f3f8f3']],
      colorbar: { title: { text: 'Å', side: 'top' }, thickness: 12, len: 0.8 },
      hovertemplate: 'Scored residue %{x} · aligned on residue %{y}<br>'
        + `Expected position error %{z:.1f} Å${bin > 1 ? ' (block mean)' : ''}<extra></extra>`,
    }],
    layout: {
      title: { text: `${proteinName} · PAE · fragment ${model.fragment}${binned}`,
        x: 0, xanchor: 'left', font: { size: 15 } },
      height: 500,
      margin: { l: 62, r: 20, t: 48, b: 52 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'Inter, ui-sans-serif, system-ui, sans-serif', size: 12, color: '#24354b' },
      xaxis: { title: { text: 'Scored residue' }, constrain: 'domain' },
      yaxis: { title: { text: 'Aligned residue' }, autorange: 'reversed', scaleanchor: 'x', constrain: 'domain' },
      shapes: guides,
    },
  }
}

/** Render the heatmap and report the scored residue of a clicked cell. */
export async function renderPae(
  element: HTMLDivElement,
  figure: FigureSpec,
  onPosition: (position: number) => void,
): Promise<void> {
  const Plotly = (await import('plotly.js-cartesian-dist-min')).default
  const graph = await Plotly.react(element, figure.data, figure.layout,
    { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['sendChartToCloud'] })
  graph.removeAllListeners('plotly_click')
  graph.on('plotly_click', (event) => {
    const position = event.points[0]?.x
    if (typeof position === 'number') onPosition(position)
  })
}
