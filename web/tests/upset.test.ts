import assert from 'node:assert/strict'
import { test } from 'node:test'

import { UNAVAILABLE_STRUCTURE } from '../src/structural.js'
import {
  buildUpSetFigure,
  computeUpSet,
  contrastsForIntersection,
  rowsForIntersection,
  siteIdentity,
} from '../src/upset.js'
import type { SiteIndexRow } from '../src/types.js'

function row(overrides: Partial<SiteIndexRow> = {}): SiteIndexRow {
  return {
    protein_Id: 'P1', site: 'S10', contrast: 'A', posInProtein: 10, modAA: 'S',
    sequence_window: 'AAAAAAASAAAAAAA', gene_name: 'One', protein_length: 100,
    effect: 2, fdr: 0.01, p_value: 0.001, std_error: 0.2,
    site_estimate_type: 'observed', protein_estimate_type: 'observed', imputed: false,
    original_site_fc: 2, protein_fc: 1, accession: 'P1', has_measurement: true,
    structure: UNAVAILABLE_STRUCTURE,
    ...overrides,
  }
}

test('UpSet groups exact significant-site membership across contrasts', () => {
  const rows = [
    row(),
    row({ contrast: 'B', effect: -3 }),
    row({ contrast: 'C', fdr: 0.4 }),
    row({ protein_Id: 'P2', accession: 'P2', gene_name: 'Two', site: 'T20', contrast: 'A' }),
    row({ protein_Id: 'P3', accession: 'P3', gene_name: 'Three', site: 'Y30', contrast: 'B' }),
    row({ protein_Id: 'P4', accession: 'P4', gene_name: 'Four', site: 'S40', contrast: 'C' }),
    row({ protein_Id: 'P4', accession: 'P4', gene_name: 'Four', site: 'S40', contrast: 'C' }),
    row({ protein_Id: 'P5', accession: 'P5', gene_name: 'Five', site: 'T50', contrast: 'A', effect: 1 }),
  ]

  const model = computeUpSet(rows, ['A', 'B', 'C'], { fdr: 0.05, absEffect: 1 })

  assert.deepEqual(model.setSizes, [2, 2, 1])
  assert.equal(model.intersections.length, 4)
  const shared = model.intersections.find((intersection) => intersection.key === '0,1')
  assert.ok(shared)
  assert.deepEqual(shared.contrasts, ['A', 'B'])
  assert.deepEqual(contrastsForIntersection(model.contrasts, shared), ['A', 'B'])
  assert.deepEqual(contrastsForIntersection(model.contrasts, null), ['A', 'B', 'C'])
  assert.equal(shared.siteCount, 1)
  assert.equal(shared.proteinCount, 1)
  assert.deepEqual(shared.sitesByProtein.get('P1'), ['S10'])
  assert.ok(shared.siteKeys.has(siteIdentity('P1', 'S10')))

  const selectedRows = rowsForIntersection(rows, shared)
  assert.deepEqual(selectedRows.map((selected) => selected.contrast), ['A', 'B', 'C'])
  assert.ok(selectedRows.some((selected) => selected.contrast === 'C' && selected.fdr === 0.4))
})

test('UpSet figure exposes every intersection column as one clickable selection', () => {
  const model = computeUpSet([
    row(),
    row({ contrast: 'B' }),
    row({ protein_Id: 'P2', accession: 'P2', site: 'T20', contrast: 'A' }),
  ], ['A', 'B'], { fdr: 0.05, absEffect: 1 })

  const figure = buildUpSetFigure(model, '0,1')
  const bars = figure.data.find((trace) => trace.name === 'Intersection sites')!
  const background = figure.data.find((trace) => trace.name === 'Intersection matrix')!
  const membership = figure.data.find((trace) => trace.name === 'Membership')!

  assert.deepEqual(bars.customdata, model.intersections.map((intersection) => intersection.key))
  assert.equal((background.customdata as string[]).length, model.intersections.length * 2)
  assert.ok((membership.customdata as string[]).every((key) => model.intersections.some(
    (intersection) => intersection.key === key,
  )))
  assert.match(JSON.stringify(figure.layout), /Intersection size/)
})
