import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildEnrichmentFigure,
  buildGseaVolcanoFigure,
  gseaSelectionView,
  gseaNavigationRows,
  navigableSequenceSets,
  selectedMemberships,
  sequenceSetKey,
  sequenceSetsAtFdr,
} from '../src/gsea.js'
import { renderGseaControls, renderGseaNavigation } from '../src/gsea-view.js'
import { sequenceRelation } from '../src/filtering.js'
import { resolveSelection, siteIdentity } from '../src/upset-model.js'
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
  const all = sequenceRelation(payload, 0.05, false)
  const leading = sequenceRelation(payload, 0.05, true)
  assert.equal(all.sets.length, 1)
  assert.deepEqual(resolveSelection(all, {kind:'set',id:key}), new Set(['P1\u0000S1','P1\u0000S2']))
  assert.deepEqual(resolveSelection(leading, {kind:'set',id:key}), new Set(['P1\u0000S1']))
  assert.equal(sequenceRelation(payload, 0.01, false).sets.length, 0)
  assert.equal(sequenceRelation(payload, 0.3, false).sets.length, 2)
  assert.deepEqual(selectedMemberships(payload, key, false).map((row) => row.rank), [1, 2])
})

test('B keeps equal set names from different sources as distinct relation keys', () => {
  const another={...payload,sequenceSets:[...payload.sequenceSets,
    {...payload.sequenceSets[0],source:'PTM-SEA'}],memberships:[...payload.memberships,
    {...payload.memberships[0],source:'PTM-SEA',site:'S4'}]}
  const model=sequenceRelation(another,0.05,false)
  assert.equal(model.sets.length,2)
  assert.deepEqual(resolveSelection(model,{kind:'set',id:sequenceSetKey('PTM-SEA','ERK2')}),
    new Set(['P1\u0000S4']))
  assert.deepEqual(resolveSelection(model,{kind:'intersection',ids:[sequenceSetKey('KinaseLib','ERK2')]}),
    new Set(['P1\u0000S1','P1\u0000S2']))
})

test('GSEA FDR controls the sequence-set choices and overview threshold', () => {
  assert.deepEqual(sequenceSetsAtFdr(payload, 0.05).map((row) => row.sequence_set), ['ERK2'])
  const figure = buildGseaVolcanoFigure(payload, 0.05, new Set([sequenceSetKey('KinaseLib', 'ERK2')]))
  assert.equal(figure.data.length, 3)
  assert.deepEqual(figure.data[2].x, [1.8])
  assert.equal((figure.layout.shapes as Array<{ y0: number }>)[0].y0, -Math.log10(0.05))
})

test('navigation offers only sequence sets overlapping the effective site result', () => {
  assert.deepEqual(navigableSequenceSets(payload,new Set([siteIdentity('P1','S1')]))
    .map(row=>row.sequence_set),['ERK2'])
  assert.deepEqual(navigableSequenceSets(payload,new Set([siteIdentity('P2','S3')]))
    .map(row=>row.sequence_set),['AKT1'])
  assert.deepEqual(navigableSequenceSets(payload,new Set()).map(row=>row.sequence_set),[])
  const sites=new Set([siteIdentity('P1','S1'),siteIdentity('P2','S3')])
  assert.deepEqual(gseaNavigationRows(payload,0.05,{kind:'all'},sites).map(row=>row.sequence_set),['ERK2'])
  assert.deepEqual(gseaNavigationRows(payload,0.3,{kind:'set',id:sequenceSetKey('KinaseLib','AKT1')},sites)
    .map(row=>row.sequence_set),['AKT1'])
  assert.deepEqual(gseaNavigationRows(payload,0.3,
    {kind:'intersection',ids:[sequenceSetKey('KinaseLib','ERK2'),sequenceSetKey('KinaseLib','AKT1')]},sites)
    .map(row=>row.sequence_set),['ERK2','AKT1'])
})

test('B whole and exact selections drive GSEA rows and volcano highlights, not curve identity', () => {
  const expanded={...payload,sequenceSets:[payload.sequenceSets[0],
    ...['JNK1','JNK2','JNK3'].map((sequence_set,i)=>({...payload.sequenceSets[0],
      sequence_set,nes:2+i/10,fdr:0.02+i/100}))]}
  const ids=['JNK1','JNK2','JNK3'].map(name=>sequenceSetKey('KinaseLib',name))
  const exact=gseaSelectionView(expanded,0.05,{kind:'intersection',ids})
  assert.deepEqual(exact.rows.map(row=>row.sequence_set),['JNK1','JNK2','JNK3'])
  assert.deepEqual(exact.highlighted,new Set(ids))
  assert.deepEqual(buildGseaVolcanoFigure(expanded,0.05,exact.highlighted).data[2].x,[2,2.1,2.2])
  const named=gseaSelectionView(expanded,0.05,{kind:'set',id:ids[1]})
  assert.deepEqual(named.rows.map(row=>row.sequence_set),['JNK2'])
  for (const kind of ['off','all'] as const) {
    const unfiltered=gseaSelectionView(expanded,0.05,{kind})
    assert.equal(unfiltered.rows.length,4)
    assert.equal(unfiltered.highlighted.size,0)
  }
  assert.equal(gseaSelectionView(expanded,0.025,{kind:'intersection',ids}).highlighted.size,1)
})

test('GSEA method and sequence-set navigation sit outside B filter controls', () => {
  const action=()=>{}
  const actions={changeGseaResult:action,changeSequenceSet:action,
    changeGseaFdr:action,searchSequenceSets:action,changeLeadingEdge:action}
  const navigation=renderGseaNavigation(actions).strings.join('')
  const controls=renderGseaControls(actions).strings.join('')
  assert.ok(navigation.indexOf('id="gsea-result"')<navigation.indexOf('id="sequence-set"'))
  assert.ok(!controls.includes('id="gsea-result"'))
  assert.ok(!controls.includes('id="sequence-set"'))
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
