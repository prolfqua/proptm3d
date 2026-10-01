import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeUpSet, resolveSelection, siteIdentity } from '../src/membership.js'
import { contrastsAllowedByA, FilterModel, type EnrichmentInput } from '../src/filtering.js'
import { displayedUpSet } from '../src/upset-model.js'
import { ALL_STRUCTURES, UNAVAILABLE_STRUCTURE } from '../src/structural.js'
import type { AppData, GseaPayload } from '../src/types.js'

const set=(id:string,enabled=true)=>({id,label:id,enabled})
const relation=computeUpSet([set('early'),set('late')],[
  ['a','early'],['b','early'],['b','late'],['c','late'],['b','early'],
])

test('normalized relation deduplicates pairs and distinguishes whole, exact, union and off', () => {
  assert.deepEqual(relation.union,new Set(['a','b','c']))
  assert.equal(resolveSelection(relation,{kind:'off'}),null)
  assert.deepEqual(resolveSelection(relation,{kind:'all'}),new Set(['a','b','c']))
  assert.deepEqual(resolveSelection(relation,{kind:'set',id:'early'}),new Set(['a','b']))
  assert.deepEqual(resolveSelection(relation,{kind:'intersection',ids:['early']}),new Set(['a']))
  assert.deepEqual(resolveSelection(relation,{kind:'intersection',ids:['late','early']}),new Set(['b']))
})

test('A passes only its selected contrast names to B, not its selected sites', () => {
  const contrasts=['early','late','interaction']
  assert.deepEqual(contrastsAllowedByA(contrasts,{kind:'off'}),contrasts)
  assert.deepEqual(contrastsAllowedByA(contrasts,{kind:'all'}),contrasts)
  assert.deepEqual(contrastsAllowedByA(contrasts,{kind:'set',id:'late'}),['late'])
  assert.deepEqual(contrastsAllowedByA(contrasts,{kind:'intersection',ids:['interaction','early']}),
    ['early','interaction'])
})

test('disabled and empty sets, absent combinations and more than 32 sets', () => {
  const ids=Array.from({length:40},(_,i)=>`s${i}`)
  const model=computeUpSet([...ids.map(id=>set(id)),set('disabled',false),set('empty')],
    [...ids.map(id=>['shared',id] as const),['only-s0','s0'],['only-s0','s0'],['ignored','disabled']])
  assert.equal(model.sets[0].siteKeys.size,2)
  assert.equal(model.union.size,2)
  assert.equal(model.intersections.length,2)
  assert.deepEqual(resolveSelection(model,{kind:'intersection',ids}),new Set(['shared']))
  assert.equal(resolveSelection(model,{kind:'intersection',ids:['empty']})?.size,0)
  assert.equal(model.sets.at(-1)?.siteKeys.size,0)
  assert.throws(()=>computeUpSet([set('a')],[['site','unknown']]),/unknown set/)
})

const sites=['S1','S2','S3','S4'].map((site,i)=>({protein_Id:'P1',site,
  structure:i===2?{...UNAVAILABLE_STRUCTURE,exposure:'exposed'}:UNAVAILABLE_STRUCTURE}))
const data={run:{contrasts:['early','late'],gsea:{results:[{id:'r'}]}},sites,siteIndex:[
  {protein_Id:'P1',site:'S1',contrast:'early',effect:2,fdr:0.01,site_estimate_type:'observed'},
  {protein_Id:'P1',site:'S2',contrast:'late',effect:2,fdr:0.01,site_estimate_type:'observed'},
  {protein_Id:'P1',site:'S2',contrast:'early',effect:2,fdr:0.01,site_estimate_type:'observed'},
]} as unknown as AppData
const key=(site:string)=>siteIdentity('P1',site)
const payload={sequenceSets:[
  {source:'KinaseLib',sequence_set:'K1',fdr:0.01},
  {source:'KinaseLib',sequence_set:'K2',fdr:0.04},
],memberships:[
  {source:'KinaseLib',sequence_set:'K1',protein_Id:'P1',site:'S2',is_leading_edge:true},
  {source:'KinaseLib',sequence_set:'K1',protein_Id:'P1',site:'S3',is_leading_edge:false},
  {source:'KinaseLib',sequence_set:'K1',protein_Id:'P1',site:'S3',is_leading_edge:false},
  {source:'KinaseLib',sequence_set:'K2',protein_Id:'P1',site:'S3',is_leading_edge:true},
]} as GseaPayload
const enrichment=(revision=1,overrides:Partial<EnrichmentInput>={}): EnrichmentInput=>({
  payload,fdr:0.05,leading:false,context:'r\u0000early',revision,status:'Ready',ready:true,...overrides,
})
const update=(model:FilterModel,revision=1,overrides:Partial<EnrichmentInput>={},
  structural=ALL_STRUCTURES,thresholds={fdr:0.05,absEffect:1})=>
  model.update(data,'early',thresholds,'all',structural,enrichment(revision,overrides))

test('C All is union, not implicit AND; disabled properties do not swallow it', () => {
  const model=new FilterModel()
  update(model)
  assert.deepEqual(model.siteKeys,new Set([key('S1'),key('S2')]))
  model.select('b',{kind:'all'})
  assert.deepEqual(model.siteKeys,new Set([key('S1'),key('S2'),key('S3')]))
  model.select('c',{kind:'intersection',ids:['contrast_selection','sequence_set_selection']})
  assert.deepEqual(model.siteKeys,new Set([key('S2')]))
  assert.equal(model.get('a').union.size,2)
  assert.equal(model.get('b').union.size,2)
  model.select('c',{kind:'intersection',ids:['sequence_set_selection','contrast_selection']})
  assert.deepEqual(model.state.c,{kind:'all'},'reclick ignores matrix row order')
  assert.deepEqual(model.siteKeys,new Set([key('S1'),key('S2'),key('S3')]))
  assert.deepEqual(model.state.b,{kind:'all'})
  model.select('a',{kind:'off'})
  model.select('b',{kind:'off'})
  assert.deepEqual(model.siteKeys,new Set(sites.map(s=>key(s.site))))
  update(model,2,{}, {exposure:'exposed',region:'all'})
  assert.deepEqual(model.siteKeys,new Set([key('S3')]))
})

test('A/B/C share whole/exact/reclick transitions; changes upstream reset C', () => {
  const model=new FilterModel()
  update(model)
  model.select('a',{kind:'set',id:'early'})
  assert.deepEqual(model.siteKeys,new Set([key('S1'),key('S2')]))
  model.select('a',{kind:'intersection',ids:['early']})
  assert.deepEqual(model.siteKeys,new Set([key('S1')]))
  model.select('a',{kind:'intersection',ids:['early']})
  assert.deepEqual(model.state.a,{kind:'all'})
  model.select('b',{kind:'set',id:'KinaseLib\u0000K1'})
  model.select('c',{kind:'set',id:'sequence_set_selection'})
  assert.deepEqual(model.siteKeys,new Set([key('S2'),key('S3')]))
  model.select('c',{kind:'set',id:'sequence_set_selection'})
  assert.deepEqual(model.state.c,{kind:'all'})
  model.select('c',{kind:'intersection',ids:['contrast_selection']})
  const result=update(model,2,{},ALL_STRUCTURES,{fdr:0.0001,absEffect:1})
  assert.match(result.notice,/C returned to all/)
  assert.deepEqual(model.state.b,{kind:'set',id:'KinaseLib\u0000K1'})
  assert.equal(model.get('a').union.size,0)
  assert.deepEqual(model.siteKeys,new Set([key('S2'),key('S3')]))
})

test('B FDR eligibility, leading edge, empty All and context reset are independent', () => {
  const model=new FilterModel()
  update(model)
  model.select('a',{kind:'off'})
  model.select('b',{kind:'set',id:'KinaseLib\u0000K1'})
  assert.deepEqual(model.siteKeys,new Set([key('S2'),key('S3')]))
  model.select('b',{kind:'intersection',ids:['KinaseLib\u0000K1']})
  assert.deepEqual(model.get('b').sets[0].siteKeys,new Set([key('S2'),key('S3')]))
  model.select('b',{kind:'intersection',ids:['KinaseLib\u0000K1']})
  assert.deepEqual(model.state.b,{kind:'all'})
  model.select('b',{kind:'set',id:'KinaseLib\u0000K1'})
  update(model,2,{leading:true})
  assert.deepEqual(model.siteKeys,new Set([key('S2')]))
  update(model,3,{fdr:0.02})
  assert.deepEqual(model.state.b,{kind:'set',id:'KinaseLib\u0000K1'})
  model.select('b',{kind:'intersection',ids:['KinaseLib\u0000K1']})
  update(model,4,{fdr:0.05})
  assert.deepEqual(model.state.b,{kind:'all'},'exact B selection resets when eligible universe changes')
  model.select('b',{kind:'set',id:'KinaseLib\u0000K1'})
  update(model,5,{context:'other\u0000late'})
  assert.deepEqual(model.state.b,{kind:'all'})
  update(model,6,{payload:{...payload,sequenceSets:[],memberships:[]}})
  assert.equal(model.siteKeys.size,0,'loaded empty B All does not bypass')
  update(model,7,{payload:null,ready:false,status:'Loading enrichment…'})
  assert.equal(model.enrichmentReady,false)
  assert.equal(model.select('b',{kind:'set',id:'KinaseLib\u0000K1'}),false)
  model.select('b',{kind:'off'})
  assert.deepEqual(model.siteKeys,new Set(sites.map(s=>key(s.site))))
})

test('Show all suspends and restores hierarchy, preserving selections and display context', () => {
  const model=new FilterModel()
  update(model)
  model.select('b',{kind:'all'})
  model.select('c',{kind:'intersection',ids:['contrast_selection','sequence_set_selection']})
  const before=JSON.stringify(model.state)
  model.setShowAll(true)
  assert.deepEqual(model.siteKeys,new Set(sites.map(s=>key(s.site))))
  assert.equal(model.select('a',{kind:'off'}),false)
  model.setShowAll(false)
  assert.deepEqual(model.siteKeys,new Set([key('S2')]))
  assert.equal(JSON.stringify(model.state),before)
})

test('C All displays every exact intersection so columns reconcile with its union', () => {
  const model=new FilterModel()
  model.update(data,'early',{fdr:0.05,absEffect:1},'observed',ALL_STRUCTURES,enrichment())
  model.select('a',{kind:'set',id:'late'})
  const displayed=displayedUpSet(model.get('c'),model.state.c,'all')
  assert.equal(displayed.intersections.length,2)
  assert.ok(displayed.intersections.some(group=>group.setIds.length===1
    && group.setIds[0]==='estimate' && group.siteKeys.has(key('S1'))))
  assert.equal(displayed.intersections.reduce((total,group)=>total+group.siteKeys.size,0),model.siteKeys.size)
  assert.deepEqual(model.siteKeys,new Set([key('S1'),key('S2')]))
})

test('switching the display-only GSEA method leaves explicit C selection intact while B is Off', () => {
  const model=new FilterModel()
  update(model)
  model.select('c',{kind:'intersection',ids:['contrast_selection']})
  const before=model.siteKeys
  const changed=update(model,2,{context:'another-method\u0000late',payload:{...payload,
    sequenceSets:[],memberships:[]}})
  assert.equal(changed.notice,'')
  assert.deepEqual(model.state.c,{kind:'intersection',ids:['contrast_selection']})
  assert.deepEqual(model.siteKeys,before)
})

test('C Estimate follows the shared upper contrast and changes effective sites', () => {
  const model=new FilterModel()
  model.update(data,'early',{fdr:0.05,absEffect:1},'observed',ALL_STRUCTURES,enrichment())
  assert.deepEqual(model.properties[0].siteKeys,new Set([key('S1'),key('S2')]))
  model.select('a',{kind:'off'})
  assert.deepEqual(model.siteKeys,new Set([key('S1'),key('S2')]))
  model.update(data,'late',{fdr:0.05,absEffect:1},'observed',ALL_STRUCTURES,enrichment())
  assert.deepEqual(model.properties[0].siteKeys,new Set([key('S2')]))
  assert.deepEqual(model.siteKeys,new Set([key('S2')]))
  model.select('c',{kind:'intersection',ids:['estimate']})
  model.update(data,'early',{fdr:0.05,absEffect:1},'observed',ALL_STRUCTURES,enrichment())
  assert.deepEqual(model.state.c,{kind:'all'})
  assert.deepEqual(model.siteKeys,new Set([key('S1'),key('S2')]))
})

test('upper contrast remains display-only for C while Estimate is disabled', () => {
  const model=new FilterModel()
  model.update(data,'early',{fdr:0.05,absEffect:1},'all',ALL_STRUCTURES,enrichment())
  model.select('c',{kind:'intersection',ids:['contrast_selection']})
  model.update(data,'late',{fdr:0.05,absEffect:1},'all',ALL_STRUCTURES,enrichment())
  assert.deepEqual(model.state.c,{kind:'intersection',ids:['contrast_selection']})
})
