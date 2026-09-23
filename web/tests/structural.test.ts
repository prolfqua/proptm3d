import assert from 'node:assert/strict'
import test from 'node:test'
import { buildNtoCFigure } from '../src/charts.js'
import { buildDetailRows, selectDetailRows } from '../src/detail.js'
import {
  ALL_STRUCTURES, passesStructuralFilters, structureDetail, structureLabel, siteStructure,
  UNAVAILABLE_STRUCTURE, type StructuralFilters,
} from '../src/structural.js'
import type { ProteinDetail, SiteStructuralContext } from '../src/types.js'

function context(site: string, fields: Partial<SiteStructuralContext> = {}): SiteStructuralContext {
  return {
    protein_Id: 'P1', site, accession: 'P1', posInProtein: 10, modAA: 'S', has_measurement: true,
    model_id: 'AF-P1-F1', fragment: 1, version: 6, model_position: 10, residue: 'S', plddt: 64,
    nAA_12_70_pae: 3, is_exposed: true, nAA_24_180_pae: 12, nAA_24_180_pae_smooth10: 20,
    is_idr: true, mapping_status: 'matched', ...fields,
  }
}

const unavailable = (site: string) => context(site, {
  model_id: null, fragment: null, version: null, model_position: null, residue: null, plddt: null,
  nAA_12_70_pae: null, is_exposed: null, nAA_24_180_pae: null, nAA_24_180_pae_smooth10: null,
  is_idr: null, mapping_status: 'unavailable',
})

test('matched context classifies exposure and region independently', () => {
  const exposedIdr = siteStructure(context('S10'))
  assert.deepEqual([exposedIdr.exposure, exposedIdr.region, exposedIdr.plddt], ['exposed', 'idr', 64])
  const buriedStructured = siteStructure(context('T20', { is_exposed: false, is_idr: false, plddt: 93 }))
  assert.deepEqual([buriedStructured.exposure, buriedStructured.region], ['buried', 'structured'])
  const exposedStructured = siteStructure(context('Y30', { is_idr: false }))
  assert.deepEqual([exposedStructured.exposure, exposedStructured.region], ['exposed', 'structured'])
})

test('missing and mismatched context never becomes buried or structured', () => {
  for (const structure of [
    siteStructure(unavailable('S10')),
    siteStructure(context('S10', { mapping_status: 'residue_mismatch', residue: 'A' })),
    UNAVAILABLE_STRUCTURE,
  ]) {
    assert.ok(!['exposed', 'buried'].includes(structure.exposure))
    assert.ok(!['idr', 'structured'].includes(structure.region))
    assert.equal(structure.plddt, null)
    for (const filters of [
      { exposure: 'exposed', region: 'all' }, { exposure: 'buried', region: 'all' },
      { exposure: 'all', region: 'idr' }, { exposure: 'all', region: 'structured' },
    ] as StructuralFilters[]) {
      assert.equal(passesStructuralFilters(structure, filters), false)
    }
    assert.equal(passesStructuralFilters(structure, ALL_STRUCTURES), true)
  }
  assert.equal(siteStructure(context('S10', { mapping_status: 'residue_mismatch' })).exposure,
    'residue_mismatch')
})

test('labels describe context without judging it', () => {
  assert.equal(structureLabel('S123', siteStructure(context('S123', { plddt: 64.4 }))),
    'S123 · Exposed · IDR · pLDDT 64')
  assert.equal(structureLabel('T287', siteStructure(context('T287',
    { is_exposed: false, is_idr: false, plddt: 93 }))), 'T287 · Buried · Structured · pLDDT 93')
  assert.equal(structureLabel('S410', UNAVAILABLE_STRUCTURE), 'S410 · Structural context unavailable')
  assert.match(structureDetail(siteStructure(context('S10'))), /part-sphere neighbors 3/)
})

function detail(): ProteinDetail {
  const sites = ['S10', 'T20', 'Y30', 'S40', 'S50'].map((site, index) => ({
    protein_Id: 'P1', site, posInProtein: 10 * (index + 1), modAA: site[0], has_measurement: true,
  }))
  return {
    protein: { protein_Id: 'P1', gene_name: 'P1', protein_length: 100, sequence_length: 100 },
    sites,
    results: [
      { protein_Id: 'P1', site: 'S10', contrast: 'A', effect: 2, fdr: 0.01, site_estimate_type: 'observed' },
      { protein_Id: 'P1', site: 'T20', contrast: 'A', effect: -2, fdr: 0.01, site_estimate_type: 'observed' },
      { protein_Id: 'P1', site: 'Y30', contrast: 'A', effect: 3, fdr: 0.01, site_estimate_type: 'observed' },
      { protein_Id: 'P1', site: 'S40', contrast: 'A', effect: 2, fdr: 0.4, site_estimate_type: 'observed' },
      { protein_Id: 'P1', site: 'S50', contrast: 'A', effect: 2, fdr: 0.01, site_estimate_type: 'observed' },
    ],
    context: [
      context('S10'),
      context('T20', { is_exposed: false, is_idr: false }),
      context('Y30', { mapping_status: 'residue_mismatch', residue: 'S' }),
      context('S40', { is_exposed: false }),
      unavailable('S50'),
    ],
  } as unknown as ProteinDetail
}

test('structural filters combine with significance, estimate type, and Show all', () => {
  const thresholds = { fdr: 0.05, absEffect: 1 }
  const sites = (filters: StructuralFilters, showAll = false) =>
    selectDetailRows(detail(), 'A', thresholds, 'all', showAll, filters).map((row) => row.site)

  assert.deepEqual(sites(ALL_STRUCTURES), ['S10', 'T20', 'Y30', 'S50'])
  assert.deepEqual(sites(ALL_STRUCTURES, true), ['S10', 'T20', 'Y30', 'S40', 'S50'])
  assert.deepEqual(sites({ exposure: 'exposed', region: 'all' }), ['S10'])
  assert.deepEqual(sites({ exposure: 'buried', region: 'all' }), ['T20'])
  assert.deepEqual(sites({ exposure: 'buried', region: 'all' }, true), ['T20', 'S40'])
  assert.deepEqual(sites({ exposure: 'all', region: 'idr' }, true), ['S10', 'S40'])
  assert.deepEqual(sites({ exposure: 'buried', region: 'idr' }, true), ['S40'])
  assert.deepEqual(sites({ exposure: 'exposed', region: 'structured' }, true), [])
  assert.ok(buildDetailRows(detail(), 'A', thresholds).every((row) =>
    row.passes_cutoff === (row.site !== 'S40')), 'passes_cutoff stays statistical only')
})

test('the default structural filters reproduce the pre-context selection', () => {
  const thresholds = { fdr: 0.05, absEffect: 1 }
  const withoutContext = { ...detail(), context: [] }
  for (const showAll of [false, true]) {
    assert.deepEqual(
      selectDetailRows(detail(), 'A', thresholds, 'all', showAll, ALL_STRUCTURES).map((row) => row.site),
      buildDetailRows(withoutContext, 'A', thresholds).filter((row) => showAll || row.passes_cutoff)
        .map((row) => row.site))
  }
})

test('the N-to-C plot shows exactly the structurally selected sites', () => {
  const rows = selectDetailRows(detail(), 'A', { fdr: 0.05, absEffect: 1 }, 'all', true,
    { exposure: 'buried', region: 'all' })
  const figure = buildNtoCFigure(detail(), null, 'DPA', 'A', null, 0.05, 1, new Set(rows.map((row) => row.site)))
  const plotted = figure.data.filter((trace) => trace.mode === 'markers')
    .flatMap((trace) => (trace.customdata as string[][]).map((point) => point[1]))
  assert.deepEqual(plotted.sort(), ['S40', 'T20'])
})
