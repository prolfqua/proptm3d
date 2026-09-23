import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDetailRows, displayProteinDescription, selectDetailRows } from '../src/detail.js'
import type { ProteinDetail } from '../src/types.js'

test('description display uses the prepared h5mu value without FASTA metadata', () => {
  assert.equal(displayProteinDescription('Insulin receptor substrate 2 OS=Mus musculus OX=10090 GN=Irs2'),
    'Insulin receptor substrate 2')
  assert.equal(displayProteinDescription('  Short description  '), 'Short description')
  assert.equal(displayProteinDescription(null), null)
})

test('detail shows only the selected contrast and retains measured-only and result-only sites', () => {
  const detail = {
    sites: [
      { protein_Id: 'P1', site: 'S10', posInProtein: 10, modAA: 'S', SequenceWindow: 'AAAAAAASAAAAAAA', has_measurement: true },
      { protein_Id: 'P1', site: 'T20', posInProtein: 20, modAA: 'T', SequenceWindow: 'AAAAAAATAAAAAAA', has_measurement: true },
    ],
    results: [
      { protein_Id: 'P1', site: 'S10', contrast: 'A', effect: 1.5, fdr: 0.01, p_value: 0.001,
        site_estimate_type: 'observed', imputed: false },
      { protein_Id: 'P1', site: 'S10', contrast: 'B', effect: -2, fdr: 0.03, p_value: 0.01,
        site_estimate_type: 'lod_imputed', imputed: true },
      { protein_Id: 'P1', site: 'Y30', contrast: 'B', effect: 3, fdr: 0.001, p_value: 0.0001,
        site_estimate_type: 'observed', imputed: false },
    ],
  } as ProteinDetail

  const thresholds = { fdr: 0.05, absEffect: 1 }
  const rowsA = buildDetailRows(detail, 'A', thresholds)
  assert.deepEqual(rowsA.map((row) => row.row_id), ['S10\u0000A', 'T20\u0000A'])
  assert.ok(rowsA.every((row) => row.contrast === 'A'))
  assert.equal(rowsA[0].estimate_status, 'observed')
  assert.equal(rowsA[0].passes_cutoff, true)
  assert.equal(rowsA[1].estimate_status, 'No result')
  assert.equal(rowsA[1].effect, null)
  assert.equal(rowsA[1].has_measurement, true)
  assert.equal(rowsA[1].passes_cutoff, false)

  const rowsB = buildDetailRows(detail, 'B', thresholds)
  assert.deepEqual(rowsB.map((row) => row.row_id), ['S10\u0000B', 'T20\u0000B', 'Y30\u0000B'])
  assert.ok(rowsB.every((row) => row.contrast === 'B'))
  assert.equal(rowsB[0].estimate_status, 'lod_imputed')
  assert.equal(rowsB[0].passes_cutoff, true)
  assert.equal(rowsB[2].has_measurement, false)
  assert.equal(rowsB[2].passes_cutoff, true)
})

test('detail cutoff uses strict FDR and absolute fold-change boundaries', () => {
  const detail = {
    sites: ['S10', 'T20', 'Y30', 'K40'].map((site) => ({ protein_Id: 'P1', site, has_measurement: true })),
    results: [
      { protein_Id: 'P1', site: 'S10', contrast: 'A', effect: 1.5, fdr: 0.01 },
      { protein_Id: 'P1', site: 'T20', contrast: 'A', effect: -1.5, fdr: 0.05 },
      { protein_Id: 'P1', site: 'Y30', contrast: 'A', effect: 1, fdr: 0.01 },
      { protein_Id: 'P1', site: 'K40', contrast: 'A', effect: null, fdr: 0.01 },
    ],
  } as ProteinDetail

  const passingSites = (fdr: number, absEffect: number) => buildDetailRows(detail, 'A', { fdr, absEffect })
    .filter((row) => row.passes_cutoff).map((row) => row.site)
  assert.deepEqual(passingSites(0.05, 1), ['S10'])
  assert.deepEqual(passingSites(0.1, 1), ['S10', 'T20'])
  assert.deepEqual(passingSites(0.1, 1.5), [])
})

test('detail selection defaults to passing sites and applies the estimate type', () => {
  const detail = {
    sites: ['S10', 'T20', 'Y30', 'K40', 'C50']
      .map((site) => ({ protein_Id: 'P1', site, has_measurement: true })),
    results: [
      { protein_Id: 'P1', site: 'S10', contrast: 'A', effect: 2, fdr: 0.01,
        site_estimate_type: 'observed', imputed: false },
      { protein_Id: 'P1', site: 'T20', contrast: 'A', effect: -3, fdr: 0.02,
        site_estimate_type: 'lod_imputed', imputed: true },
      { protein_Id: 'P1', site: 'Y30', contrast: 'A', effect: 2, fdr: 0.2,
        site_estimate_type: 'observed', imputed: false },
      { protein_Id: 'P1', site: 'K40', contrast: 'A', effect: 0.5, fdr: 0.01,
        site_estimate_type: 'lod_imputed', imputed: true },
      { protein_Id: 'P1', site: 'P60', contrast: 'A', effect: 4, fdr: 0.001,
        site_estimate_type: 'observed', imputed: false },
      { protein_Id: 'P1', site: 'C50', contrast: 'B', effect: 2, fdr: 0.01,
        site_estimate_type: 'observed', imputed: false },
    ],
  } as ProteinDetail
  const thresholds = { fdr: 0.05, absEffect: 1 }
  const sites = (contrast: string, estimateType: 'all' | 'observed' | 'lod_imputed', showAll: boolean) =>
    selectDetailRows(detail, contrast, thresholds, estimateType, showAll).map((row) => row.site)

  assert.deepEqual(sites('A', 'all', false), ['S10', 'T20', 'P60'])
  assert.deepEqual(sites('A', 'observed', false), ['S10', 'P60'])
  assert.deepEqual(sites('A', 'lod_imputed', false), ['T20'])
  assert.deepEqual(sites('A', 'all', true), ['S10', 'T20', 'Y30', 'K40', 'C50', 'P60'])
  assert.deepEqual(sites('A', 'observed', true), ['S10', 'Y30', 'P60'])
  assert.deepEqual(sites('A', 'lod_imputed', true), ['T20', 'K40'])
  assert.deepEqual(sites('B', 'all', false), ['C50'])
  assert.deepEqual(sites('B', 'lod_imputed', false), [])
})
