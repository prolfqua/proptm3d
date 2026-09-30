import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeUpSet, resolveSelection } from '../src/upset.js'
import { FilterSelection, relevantCombinedIntersections } from '../src/filtering.js'

const set = (id: string, sites: string[], enabled = true) => ({ id, label: id, siteKeys: new Set(sites), enabled })
const a = computeUpSet([set('early', ['p\u0000a', 'p\u0000b']), set('late', ['p\u0000b', 'p\u0000c'])])
const b = computeUpSet([set('kinase', ['p\u0000b', 'p\u0000d'])])
const universe = new Set(['p\u0000a', 'p\u0000b', 'p\u0000c', 'p\u0000d', 'p\u0000missing'])

test('off, union, whole set and exact intersection are distinct', () => {
  assert.equal(resolveSelection(a, { kind: 'off' }), null)
  assert.equal(resolveSelection(a, { kind: 'all' })?.size, 3)
  assert.deepEqual(resolveSelection(a, { kind: 'set', id: 'early' }), new Set(['p\u0000a', 'p\u0000b']))
  assert.deepEqual(resolveSelection(a, { kind: 'intersection', ids: ['early'] }), new Set(['p\u0000a']))
  assert.deepEqual(resolveSelection(a, { kind: 'intersection', ids: ['late', 'early'] }), new Set(['p\u0000b']))
})

test('C defaults to union; disabled properties never swallow the union', () => {
  const state = new FilterSelection()
  state.b = { kind: 'all' }
  const properties = [set('exposure_all', [...universe], false)]
  const model = state.combine(a, b, properties)
  assert.equal(state.effective(model, universe).size, 4)
  state.c = { kind: 'intersection', ids: ['contrast_selection', 'sequence_set_selection'] }
  assert.deepEqual(state.effective(model, universe), new Set(['p\u0000b']))
  state.showAll = true
  assert.deepEqual(state.effective(model, universe), universe)
  state.showAll = false
  assert.deepEqual(state.effective(model, universe), new Set(['p\u0000b']))
  state.resetCombined()
  assert.equal(state.effective(model, universe).size, 4)
  assert.deepEqual(state.b, { kind: 'all' })
  state.a = state.b = { kind: 'off' }
  assert.deepEqual(state.effective(state.combine(a, b, properties), universe), universe)
})

test('empty active sets remain empty; named and exact selections survive empty membership', () => {
  const state = new FilterSelection()
  const empty = computeUpSet([set('early', [])])
  state.a = { kind: 'set', id: 'early' }
  assert.equal(state.effective(state.combine(empty, b, []), universe).size, 0)
  state.a = { kind: 'intersection', ids: ['early'] }
  assert.equal(state.effective(state.combine(empty, b, []), universe).size, 0)
})

test('C selection never changes upstream models; >32 sets and duplicate identities work', () => {
  const sets = Array.from({length: 40}, (_, i) => set(`set-${i}`, ['same', `only-${i}`]))
  const model = computeUpSet(sets)
  assert.equal(model.union.size, 41)
  assert.equal(model.intersections.length, 41)
  assert.deepEqual(resolveSelection(model, {kind:'intersection', ids:sets.map(s=>s.id)}), new Set(['same']))
  const state = new FilterSelection()
  state.combine(a, b, [])
  state.c = {kind:'intersection', ids:['contrast_selection']}
  assert.equal(a.union.size, 3)
  assert.equal(b.union.size, 2)
})

test('B eligibility and context changes reset only the affected selections', () => {
  const state = new FilterSelection()
  state.b = {kind:'set', id:'kinase'}
  state.reconcileB(b, b, false)
  assert.deepEqual(state.b, {kind:'set',id:'kinase'})
  state.reconcileB(b, computeUpSet([]), false)
  assert.deepEqual(state.b, {kind:'all'})
  state.b = {kind:'off'}
  state.reconcileB(b, b, true)
  assert.deepEqual(state.b, {kind:'off'})
  state.b = {kind:'intersection',ids:['kinase']}
  state.reconcileB(b, computeUpSet([...b.sets, set('new', [])]), false)
  assert.deepEqual(state.b, {kind:'all'})
})

test('C shows the A-only, B-only and shared columns that pass all active property choices', () => {
  const model = computeUpSet([
    set('contrast_selection', ['a', 'both', 'a-without-region']),
    set('sequence_set_selection', ['b', 'both', 'b-without-exposure']),
    set('estimate', ['a', 'b', 'both', 'properties-only', 'a-without-region', 'b-without-exposure']),
    set('exposure', ['a', 'b', 'both', 'properties-only', 'a-without-region']),
    set('region', ['a', 'b', 'both', 'properties-only', 'b-without-exposure']),
  ])
  const displayed = relevantCombinedIntersections(model)
  assert.deepEqual(displayed.intersections.map(group=>[...group.siteKeys].join()).sort(),['a','b','both'])
  assert.equal(model.intersections.length,6)
  assert.equal(displayed.union.size,6)
  assert.equal(resolveSelection(model,{kind:'all'})?.size,6)
  assert.deepEqual(resolveSelection(model,{kind:'intersection',ids:['contrast_selection','estimate','exposure','region']}),new Set(['a']))
})

test('C preview requires only the property filters that are enabled', () => {
  const model = computeUpSet([
    set('contrast_selection',['a','both']),set('sequence_set_selection',['b','both']),
    set('estimate',[],false),set('exposure',['a','b','both']),set('region',[],false),
  ])
  assert.equal(relevantCombinedIntersections(model).intersections.length,3)
  assert.equal(relevantCombinedIntersections(computeUpSet([set('contrast_selection',['a'])])).intersections.length,1)
})
