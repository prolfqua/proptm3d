// The N-to-C lollipop figure: one row per contrast sharing the residue axis,
// a stick from zero to each site's log2FC, the head colored like the 3D sphere,
// dashed sticks for imputed estimates, an asterisk over significant sites, and
// a band at the protein-level log2FC where the analysis has one.
//
// Pure: rows in, a Plotly {data, layout} out. No DOM and no Plotly import, so
// node tests can build figures directly.

export const RESIDUE_COLORS = { S: '#56b4e9', T: '#e69f00', Y: '#cc79a7' } // Okabe-Ito.
const OTHER_RESIDUE_COLOR = '#94a3b8'
const BAND_COLOR = 'rgba(250, 204, 21, 0.35)'
const BAND_LINE_COLOR = 'rgba(250, 204, 21, 0.9)'
const GRID_COLOR = '#1e293b'
const ZERO_COLOR = '#475569'
const TEXT_COLOR = '#cbd5e1'
const MUTED_COLOR = '#64748b'
const STAR_COLOR = '#f8fafc'
const ROW_GAP = 0.08
const HEAD_SIZE = 8
const HEAD_SIZE_DIM = 5
const HEAD_SIZE_HIGHLIGHTED = 14
const AXIS_PADDING = 0.015 // Fraction of the protein length kept free at both ends.

export const residueColor = (modAa) => RESIDUE_COLORS[modAa] || OTHER_RESIDUE_COLOR

const fdrText = (value) => (value < 0.001 ? value.toExponential(1) : value.toFixed(3))

const signed = (value) => `${value > 0 ? '+' : ''}${value.toFixed(2)}`

/**
 * Hover text of one site.
 *
 * @param {object} p A decorated PTM record.
 * @returns {string} HTML for Plotly's hover label.
 */
export function hoverText (p) {
  const lines = [
    `<b>${p.mod_aa}${p.res_num}</b> ${p.contrast}`,
    `log2FC ${signed(p.log2fc)} | FDR ${fdrText(p.fdr)}${p.imputed ? ' | imputed' : ''}`
  ]
  if (p.plddt !== null && p.plddt !== undefined) {
    const exposure = p.ppse === null || p.ppse === undefined ? '-' : p.ppse.toFixed(0)
    lines.push(`pLDDT ${p.plddt.toFixed(0)} | exposure ${exposure}`)
  }
  if (p.seq_window) lines.push(p.seq_window)
  return lines.join('<br>')
}

/**
 * The symmetric log2FC range shared by every row, so rows are comparable.
 *
 * @param {Array<{ptms: object[]}>} rows The rows.
 * @param {Object<string, number>} proteinLog2fc Protein-level log2FC per contrast.
 * @returns {[number, number]} The y-axis range.
 */
export function sharedRange (rows, proteinLog2fc) {
  const values = rows.flatMap((row) => row.ptms.map((p) => Math.abs(p.log2fc)))
  Object.values(proteinLog2fc).forEach((value) => values.push(Math.abs(value)))
  const extent = Math.max(1, ...values) * 1.25
  return [-extent, extent]
}

/**
 * Stick traces of one row, grouped so each group is one line style.
 *
 * @param {object[]} ptms Decorated PTM records of the row.
 * @param {string} yaxis The row's y-axis id.
 * @returns {object[]} Plotly line traces.
 */
function stickTraces (ptms, yaxis) {
  const groups = new Map()
  ptms.forEach((p) => {
    const key = `${p.mod_aa}|${p.imputed ? 'dash' : 'solid'}|${p.dim ? 'dim' : 'full'}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(p)
  })
  return [...groups.entries()].map(([key, members]) => {
    const [modAa, dash, emphasis] = key.split('|')
    return {
      type: 'scatter',
      mode: 'lines',
      x: members.flatMap((p) => [p.res_num, p.res_num, null]),
      y: members.flatMap((p) => [0, p.log2fc, null]),
      line: { color: residueColor(modAa), width: 1.5, dash },
      opacity: emphasis === 'dim' ? 0.35 : 0.9,
      hoverinfo: 'skip',
      showlegend: false,
      xaxis: 'x',
      yaxis
    }
  })
}

/**
 * The head markers of one row: color as in 3D, open symbol when imputed,
 * larger when highlighted, and the record index as customdata for clicks.
 */
function headTrace (ptms, yaxis, highlighted, indexOffset) {
  const isHighlighted = (p) =>
    highlighted !== null && highlighted.contrast === p.contrast && highlighted.resNum === p.res_num
  return {
    type: 'scatter',
    mode: 'markers',
    x: ptms.map((p) => p.res_num),
    y: ptms.map((p) => p.log2fc),
    marker: {
      color: ptms.map((p) => p.color),
      size: ptms.map((p) => (isHighlighted(p) ? HEAD_SIZE_HIGHLIGHTED : p.dim ? HEAD_SIZE_DIM : HEAD_SIZE)),
      symbol: ptms.map((p) => (p.imputed ? 'circle-open' : 'circle')),
      opacity: ptms.map((p) => (p.dim ? 0.45 : 1)),
      line: {
        color: ptms.map((p) => (isHighlighted(p) ? STAR_COLOR : residueColor(p.mod_aa))),
        width: ptms.map((p) => (isHighlighted(p) ? 2.5 : 1.2))
      }
    },
    text: ptms.map(hoverText),
    hovertemplate: '%{text}<extra></extra>',
    customdata: ptms.map((_, i) => indexOffset + i),
    showlegend: false,
    xaxis: 'x',
    yaxis
  }
}

/** Asterisks above (or below) the heads of significant sites. */
function starTrace (ptms, yaxis, fdrThreshold, range) {
  const significant = ptms.filter((p) => p.fdr <= fdrThreshold && !p.dim)
  const offset = range[1] * 0.1
  return {
    type: 'scatter',
    mode: 'text',
    x: significant.map((p) => p.res_num),
    y: significant.map((p) => p.log2fc + (p.log2fc >= 0 ? offset : -offset)),
    text: significant.map(() => '*'),
    textfont: { color: STAR_COLOR, size: 14 },
    hoverinfo: 'skip',
    showlegend: false,
    xaxis: 'x',
    yaxis
  }
}

/** Legend entries: one per residue plus the imputed line style. */
function legendTraces () {
  const entries = Object.entries(RESIDUE_COLORS).map(([modAa, color]) => ({
    type: 'scatter',
    mode: 'lines',
    x: [null],
    y: [null],
    name: modAa,
    line: { color, width: 3 },
    hoverinfo: 'skip',
    showlegend: true
  }))
  entries.push({
    type: 'scatter',
    mode: 'lines',
    x: [null],
    y: [null],
    name: 'imputed',
    line: { color: OTHER_RESIDUE_COLOR, width: 1.5, dash: 'dash' },
    hoverinfo: 'skip',
    showlegend: true
  })
  return entries
}

/**
 * Build the N-to-C figure.
 *
 * @param {object} options Figure inputs.
 * @param {Array<{contrast: string, ptms: object[]}>} options.rows One row per contrast,
 *   in display order; each PTM record is decorated with `color` and `dim` as for the
 *   3D view and carries `imputed`.
 * @param {number} options.proteinLength Residue axis extent.
 * @param {Object<string, number>} [options.proteinLog2fc] Protein-level log2FC per contrast.
 * @param {number} [options.fdrThreshold] FDR at or below which a site gets an asterisk.
 * @param {{contrast: string, resNum: number}|null} [options.highlighted] The emphasized site.
 * @returns {{data: object[], layout: object, records: object[]}} The Plotly figure and
 *   the flat record list that head `customdata` indexes into.
 */
export function ntocFigure ({
  rows,
  proteinLength,
  proteinLog2fc = {},
  fdrThreshold = 0.05,
  highlighted = null
}) {
  const range = sharedRange(rows, proteinLog2fc)
  const count = Math.max(1, rows.length)
  const rowHeight = (1 - ROW_GAP * (count - 1)) / count
  const data = legendTraces()
  const records = []
  const shapes = []
  const annotations = []
  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: '#0b0f19',
    font: { color: TEXT_COLOR, size: 11 },
    margin: { l: 52, r: 12, t: 26, b: 34 },
    showlegend: true,
    legend: {
      orientation: 'h',
      x: 1,
      xanchor: 'right',
      y: 1,
      yanchor: 'bottom',
      font: { size: 10 },
      itemwidth: 30
    },
    hovermode: 'closest',
    xaxis: {
      range: [-proteinLength * AXIS_PADDING, proteinLength * (1 + AXIS_PADDING)],
      title: { text: 'residue', standoff: 6 },
      gridcolor: GRID_COLOR,
      zeroline: false,
      anchor: `y${count > 1 ? count : ''}`
    }
  }

  rows.forEach((row, index) => {
    const axisId = index === 0 ? 'y' : `y${index + 1}`
    const axisKey = index === 0 ? 'yaxis' : `yaxis${index + 1}`
    const top = 1 - index * (rowHeight + ROW_GAP)
    layout[axisKey] = {
      domain: [Math.max(0, top - rowHeight), top],
      range,
      title: { text: 'log2FC', standoff: 4 },
      gridcolor: GRID_COLOR,
      zeroline: true,
      zerolinecolor: ZERO_COLOR,
      zerolinewidth: 1.5,
      anchor: 'x'
    }
    data.push(...stickTraces(row.ptms, axisId))
    data.push(headTrace(row.ptms, axisId, highlighted, records.length))
    data.push(starTrace(row.ptms, axisId, fdrThreshold, range))
    records.push(...row.ptms)

    annotations.push({
      xref: 'paper',
      x: 0,
      xanchor: 'left',
      yref: `${axisId} domain`,
      y: 1,
      yanchor: 'top',
      text: `<b>${row.contrast}</b>`,
      showarrow: false,
      font: { size: 11, color: TEXT_COLOR },
      bgcolor: 'rgba(15, 23, 42, 0.75)',
      borderpad: 2
    })

    const band = proteinLog2fc[row.contrast]
    if (band === undefined || band === null) {
      annotations.push({
        xref: 'paper',
        x: 1,
        xanchor: 'right',
        yref: `${axisId} domain`,
        y: 0,
        yanchor: 'bottom',
        text: 'no protein estimate',
        showarrow: false,
        font: { size: 9, color: MUTED_COLOR }
      })
    } else {
      const halfHeight = range[1] * 0.03
      shapes.push({
        type: 'rect',
        xref: 'x',
        yref: axisId,
        x0: 0,
        x1: proteinLength,
        y0: band - halfHeight,
        y1: band + halfHeight,
        fillcolor: BAND_COLOR,
        line: { color: BAND_LINE_COLOR, width: 0.5 },
        layer: 'below'
      })
      annotations.push({
        xref: 'paper',
        x: 1,
        xanchor: 'right',
        yref: axisId,
        y: band,
        yanchor: band >= 0 ? 'bottom' : 'top',
        text: `protein ${signed(band)}`,
        showarrow: false,
        font: { size: 9, color: BAND_LINE_COLOR }
      })
    }
  })

  layout.shapes = shapes
  layout.annotations = annotations
  return { data, layout, records }
}
