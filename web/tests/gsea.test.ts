import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildEnrichmentFigure,
  buildGseaVolcanoFigure,
  selectedMemberships,
  sequenceSetKey,
  sequenceSetsAtFdr,
} from '../src/gsea.js'
import { sequenceSets } from '../src/filtering.js'
import { computeUpSet, resolveSelection, siteIdentity } from '../src/upset.js'
import type { GseaPayload } from '../src/types.js'

const payload: GseaPayload = {
  result: {
    id: 'KinaseGSEA', label: 'Kinase GSEA', sources: ['KinaseLib'], contrasts: {},
  },
  contrast: 'KO_vs_WT',
  sequenceSets: [
    {
      analysis: 'DPA', contrast: 'KO_vs_WT', source: 'KinaseLib',
      result_stage: 'KinaseGSEA', sequence_set: 'ERK2', description: 'ERK2 kinase',
      nes: 1.8, direction: 'top', fdr: 0.01, method: 'fgsea',
      genes_mapped: 2, genes_in_set: 4,
    },
    {
      analysis: 'DPA', contrast: 'KO_vs_WT', source: 'KinaseLib',
      result_stage: 'KinaseGSEA', sequence_set: 'AKT1', description: 'AKT1 kinase',
      nes: -1.2, direction: 'bottom', fdr: 0.2, method: 'fgsea',
      genes_mapped: 1, genes_in_set: 3,
    },
  ],
  memberships: [
    { source: 'KinaseLib', sequence_set: 'ERK2', protein_Id: 'P1', site: 'S1',
      sequence_window: 'AAAA', rank: 1, running_score: 0.8, is_leading_edge: true },
    { source: 'KinaseLib', sequence_set: 'ERK2', protein_Id: 'P1', site: 'S2',
      sequence_window: 'BBBB', rank: 2, running_score: 1.8, is_leading_edge: false },
    { source: 'KinaseLib', sequence_set: 'AKT1', protein_Id: 'P2', site: 'S3',
      sequence_window: 'CCCC', rank: 1, running_score: -0.5, is_leading_edge: true },
  ],
  curves: [
    { source: 'KinaseLib', sequence_set: 'ERK2', rank_indices: [1, 2, 3],
      running_scores: [0, 0.8, 1.8], hit_indices: [1, 2], hit_scores: [0.8, 1.8] },
  ],
}

test('B eligibility, full membership and leading-edge subsets are independent', () => {
  const key = sequenceSetKey('KinaseLib', 'ERK2')
  const all = computeUpSet(sequenceSets(payload, 0.05, false))
  const leading = computeUpSet(sequenceSets(payload, 0.05, true))
  assert.equal(all.sets.length, 1)
  assert.deepEqual(resolveSelection(all, {kind:'set',id:key}), new Set(['P1\u0000S1','P1\u0000S2']))
  assert.deepEqual(resolveSelection(leading, {kind:'set',id:key}), new Set(['P1\u0000S1']))
  assert.equal(sequenceSets(payload, 0.01, false).length, 0)
  assert.equal(sequenceSets(payload, 0.3, false).length, 2)
  assert.deepEqual(selectedMemberships(payload, key, false).map((row) => row.rank), [1, 2])
})

test('GSEA FDR controls the sequence-set choices and overview threshold', () => {
  assert.deepEqual(sequenceSetsAtFdr(payload, 0.05).map((row) => row.sequence_set), ['ERK2'])
  const figure = buildGseaVolcanoFigure(payload, 0.05, sequenceSetKey('KinaseLib', 'ERK2'))
  assert.equal(figure.data.length, 3)
  assert.deepEqual(figure.data[2].x, [1.8])
  assert.equal((figure.layout.shapes as Array<{ y0: number }>)[0].y0, -Math.log10(0.05))
})

test('selected sequence set renders its native running enrichment curve and hits', () => {
  const figure = buildEnrichmentFigure(payload, sequenceSetKey('KinaseLib', 'ERK2'))
  assert.ok(figure)
  assert.deepEqual(figure.data[0].y, [0, 0.8, 1.8])
  assert.deepEqual(figure.data[1].x, [1, 2])
  assert.deepEqual(figure.data[2].x, [1])
  assert.deepEqual(figure.data[1].customdata, [
    [1, 'P1 · S1', ['P1\u0000S1\u00001']],
    [2, 'P1 · S2', ['P1\u0000S2\u00002']],
  ])
  assert.equal(buildEnrichmentFigure(payload, sequenceSetKey('KinaseLib', 'AKT1')), null)
})

test('C highlights use rank identity and never change the full curve or leading edge', () => {
  const reordered = {...payload, memberships:[payload.memberships[1],payload.memberships[0],payload.memberships[2]]}
  const key = sequenceSetKey('KinaseLib','ERK2')
  const base = buildEnrichmentFigure(reordered, key)!
  const selected = buildEnrichmentFigure(reordered, key, new Set([siteIdentity('P1','S2')]))!
  assert.deepEqual(selected.data.slice(0,3), base.data.slice(0,3))
  assert.deepEqual(selected.data[3].x,[2])
  assert.deepEqual(selected.data[3].y,[1.8])
  assert.deepEqual(selected.data[2].x,[1])
})
