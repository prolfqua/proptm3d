import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hoverText, ntocFigure, sharedRange } from '../../src/ptm3d/assets/panels/ntoc.js'

const site = (overrides) => ({
  res_num: 10,
  mod_aa: 'S',
  log2fc: 1.5,
  fdr: 0.01,
  contrast: 'A_vs_B',
  imputed: false,
  plddt: 88,
  ppse: 12,
  seq_window: 'AAAASAAAA',
  color: '#ff0000',
  dim: false,
  ...overrides
})

const rows = () => [
  {
    contrast: 'A_vs_B',
    ptms: [site(), site({ res_num: 20, mod_aa: 'T', log2fc: -2, fdr: 0.3, imputed: true })]
  },
  { contrast: 'C_vs_B', ptms: [site({ res_num: 30, mod_aa: 'Y', log2fc: 0.3, fdr: 0.04, contrast: 'C_vs_B' })] }
]

const tracesOn = (figure, yaxis) => figure.data.filter((trace) => trace.yaxis === yaxis)

test('one y-axis per contrast, sharing the residue axis and a symmetric range', () => {
  const figure = ntocFigure({ rows: rows(), proteinLength: 360, proteinLog2fc: { A_vs_B: 0.4 } })
  const [low, high] = figure.layout.xaxis.range
  assert.ok(low < 0 && low > -6)
  assert.ok(high > 360 && high < 366)
  assert.deepEqual(figure.layout.yaxis.range, [-2.5, 2.5])
  assert.deepEqual(figure.layout.yaxis2.range, [-2.5, 2.5])
  assert.equal(figure.layout.yaxis.domain[1], 1)
  assert.equal(figure.layout.yaxis2.domain[0], 0)
  assert.ok(figure.layout.yaxis.domain[0] > figure.layout.yaxis2.domain[1])
  assert.equal(figure.layout.xaxis.anchor, 'y2')
})

test('sticks run from zero to the effect and are dashed when imputed', () => {
  const figure = ntocFigure({ rows: rows(), proteinLength: 360 })
  const sticks = tracesOn(figure, 'y').filter((trace) => trace.mode === 'lines')
  const solid = sticks.find((trace) => trace.line.dash === 'solid')
  const dashed = sticks.find((trace) => trace.line.dash === 'dash')
  assert.deepEqual(solid.x, [10, 10, null])
  assert.deepEqual(solid.y, [0, 1.5, null])
  assert.deepEqual(dashed.y, [0, -2, null])
  assert.equal(solid.line.color, '#56b4e9')
  assert.equal(dashed.line.color, '#e69f00')
})

test('heads take the 3D color, open symbols when imputed, and index the record list', () => {
  const figure = ntocFigure({ rows: rows(), proteinLength: 360 })
  const heads = tracesOn(figure, 'y').find((trace) => trace.mode === 'markers')
  assert.deepEqual(heads.marker.color, ['#ff0000', '#ff0000'])
  assert.deepEqual(heads.marker.symbol, ['circle', 'circle-open'])
  assert.deepEqual(heads.customdata, [0, 1])
  const secondRow = tracesOn(figure, 'y2').find((trace) => trace.mode === 'markers')
  assert.deepEqual(secondRow.customdata, [2])
  assert.equal(figure.records[2].res_num, 30)
})

test('a highlighted site gets the large head', () => {
  const figure = ntocFigure({
    rows: rows(),
    proteinLength: 360,
    highlighted: { contrast: 'A_vs_B', resNum: 20 }
  })
  const heads = tracesOn(figure, 'y').find((trace) => trace.mode === 'markers')
  assert.deepEqual(heads.marker.size, [8, 14])
})

test('asterisks mark sites at or below the FDR threshold, on the effect side', () => {
  const figure = ntocFigure({ rows: rows(), proteinLength: 360, fdrThreshold: 0.05 })
  const stars = tracesOn(figure, 'y').find((trace) => trace.mode === 'text')
  assert.deepEqual(stars.x, [10])
  assert.ok(stars.y[0] > 1.5)
  const loose = ntocFigure({ rows: rows(), proteinLength: 360, fdrThreshold: 0.5 })
  const looseStars = tracesOn(loose, 'y').find((trace) => trace.mode === 'text')
  assert.deepEqual(looseStars.x, [10, 20])
  assert.ok(looseStars.y[1] < -2)
})

test('the protein band appears only for contrasts with a protein estimate', () => {
  const figure = ntocFigure({ rows: rows(), proteinLength: 360, proteinLog2fc: { A_vs_B: 0.4 } })
  assert.equal(figure.layout.shapes.length, 1)
  const [band] = figure.layout.shapes
  assert.equal(band.yref, 'y')
  assert.equal(band.x1, 360)
  assert.ok(band.y0 < 0.4 && band.y1 > 0.4)
  const notes = figure.layout.annotations.map((a) => a.text)
  assert.ok(notes.includes('protein +0.40'))
  assert.ok(notes.includes('no protein estimate'))
  assert.ok(notes.includes('<b>A_vs_B</b>'))
})

test('dim context sites never get an asterisk', () => {
  const dimmed = rows()
  dimmed[0].ptms[0].dim = true
  const figure = ntocFigure({ rows: dimmed, proteinLength: 360 })
  const stars = tracesOn(figure, 'y').find((trace) => trace.mode === 'text')
  assert.deepEqual(stars.x, [])
})

test('shared range never collapses below one log2 unit', () => {
  assert.deepEqual(sharedRange([{ ptms: [site({ log2fc: 0.1 })] }], {}), [-1.25, 1.25])
})

test('hover text names the site, statistics, and structure context', () => {
  const text = hoverText(site({ imputed: true }))
  assert.match(text, /<b>S10<\/b> A_vs_B/)
  assert.match(text, /log2FC \+1\.50 \| FDR 0\.010 \| imputed/)
  assert.match(text, /pLDDT 88 \| exposure 12/)
  assert.match(text, /AAAASAAAA/)
  assert.doesNotMatch(hoverText(site({ plddt: null })), /pLDDT/)
})
