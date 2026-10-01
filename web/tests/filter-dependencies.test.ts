import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterStatus } from '../src/filter-status.js'
import { chooseDisplayedContrast, FilterModel, NO_ENRICHMENT } from '../src/filtering.js'
import { gseaNavigationRows, resolveEnrichmentContext, sequenceSetKey } from '../src/gsea.js'
import { siteIdentity } from '../src/membership.js'
import { ALL_STRUCTURES, UNAVAILABLE_STRUCTURE } from '../src/structural.js'
import type { AppData, GseaPayload } from '../src/types.js'

const files={sequence_sets_parquet:'sets',memberships_parquet:'members',curves_parquet:'curves'}
const sites=['S1','S2','S3','S4','S5'].map(site=>({
  protein_Id:'P1',site,structure:UNAVAILABLE_STRUCTURE,
}))
const results=[
  {protein_Id:'P1',site:'S1',contrast:'early',effect:2,fdr:0.01,site_estimate_type:'observed'},
  {protein_Id:'P1',site:'S2',contrast:'early',effect:2,fdr:0.01,site_estimate_type:'observed'},
  {protein_Id:'P1',site:'S2',contrast:'late',effect:2,fdr:0.01,site_estimate_type:'observed'},
  {protein_Id:'P1',site:'S3',contrast:'late',effect:2,fdr:0.01,site_estimate_type:'observed'},
  {protein_Id:'P1',site:'S4',contrast:'late',effect:0.2,fdr:0.5,site_estimate_type:'observed'},
]
const data={run:{contrasts:['early','late'],gsea:{results:[
  {id:'early-result',label:'Early',contrasts:{early:files}},
  {id:'late-result',label:'Late',contrasts:{late:files}},
]}},sites,siteIndex:results} as unknown as AppData
const statsData={...data,run:{...data.run,gsea:undefined}} as AppData
const payload={sequenceSets:[
  {source:'KinaseLib',sequence_set:'K-LATE',fdr:0.01},
],memberships:[
  {source:'KinaseLib',sequence_set:'K-LATE',protein_Id:'P1',site:'S3',is_leading_edge:true},
  {source:'KinaseLib',sequence_set:'K-LATE',protein_Id:'P1',site:'S5',is_leading_edge:false},
]} as GseaPayload
const key=(site:string)=>siteIdentity('P1',site)
const thresholds={fdr:0.05,absEffect:1}
const enrichment=(revision:number,leading=false)=>({
  payload,fdr:0.05,leading,context:'late-result\u0000late',revision,status:'Ready',ready:true,
})
function expectAllColumnsPartitionC(model:FilterModel): void {
  assert.deepEqual(model.state.c,{kind:'all'})
  assert.equal(model.get('c').intersections.reduce((sum,group)=>sum+group.siteKeys.size,0),
    model.siteKeys.size)
}

test('Stats dependencies A → upper contrast → Estimate → C work without a DOM', () => {
  assert.equal(typeof document,'undefined')
  const model=new FilterModel()
  model.update(statsData,'early',thresholds,'all',ALL_STRUCTURES,NO_ENRICHMENT)
  model.select('a',{kind:'set',id:'late'})
  const upper=chooseDisplayedContrast(model.bContrasts,'early')
  assert.equal(upper,'late')
  model.update(statsData,upper,thresholds,'observed',ALL_STRUCTURES,NO_ENRICHMENT)
  assert.equal(model.includeB,false)
  assert.deepEqual(model.siteKeys,new Set([key('S2'),key('S3'),key('S4')]))
  expectAllColumnsPartitionC(model)
  assert.match(filterStatus(model,['a','c'],upper,'','').text,
    /Filtering by A \+ C · 3 \/ 5 sites selected.*C: all \(union\).*Estimate contrast: late/)
  model.select('c',{kind:'intersection',ids:['contrast_selection','estimate']})
  assert.deepEqual(model.siteKeys,new Set([key('S2'),key('S3')]))
  model.select('a',{kind:'off'})
  model.update(statsData,upper,thresholds,'all',ALL_STRUCTURES,NO_ENRICHMENT)
  assert.deepEqual(model.siteKeys,new Set(sites.map(site=>key(site.site))))
  assert.equal(filterStatus(model,['a','c'],upper,'','').active,false)
})

test('GSEA dependencies A → upper contrast/result → B → C, including loading and leading edge', () => {
  assert.equal(typeof document,'undefined')
  const model=new FilterModel()
  model.update(data,'early',thresholds,'all',ALL_STRUCTURES,NO_ENRICHMENT)
  model.select('a',{kind:'set',id:'late'})
  const upper=chooseDisplayedContrast(model.bContrasts,'early')
  const context=resolveEnrichmentContext(data.run,model.bContrasts,'early-result',upper)
  assert.deepEqual([upper,context.resultId,context.contrast],['late','late-result','late'])
  model.update(data,upper,thresholds,'observed',ALL_STRUCTURES,enrichment(1))
  const set=sequenceSetKey('KinaseLib','K-LATE')
  model.select('b',{kind:'set',id:set})
  assert.deepEqual(model.get('a').sets.find(row=>row.id==='late')?.siteKeys,
    new Set([key('S2'),key('S3')]))
  assert.deepEqual(model.get('b').sets[0].siteKeys,new Set([key('S3'),key('S5')]))
  assert.deepEqual(model.siteKeys,new Set([key('S2'),key('S3'),key('S4'),key('S5')]))
  expectAllColumnsPartitionC(model)
  assert.match(filterStatus(model,['b','a','c'],upper,'Late','late').text,
    /Filtering by A \+ B \+ C · 4 \/ 5 sites selected.*B filter: Late · late/)
  assert.deepEqual(gseaNavigationRows(payload,0.05,model.state.b,model.siteKeys)
    .map(row=>row.sequence_set),['K-LATE'])
  model.select('c',{kind:'intersection',
    ids:['contrast_selection','sequence_set_selection','estimate']})
  assert.deepEqual(model.siteKeys,new Set([key('S3')]))
  model.update(data,upper,thresholds,'observed',ALL_STRUCTURES,
    {...enrichment(2),payload:null,status:'Loading enrichment…',ready:false})
  assert.equal(model.siteKeys.size,0,'loading B must not silently bypass its active selection')
  assert.deepEqual(model.state.c,{kind:'all'})
  model.update(data,upper,thresholds,'observed',ALL_STRUCTURES,enrichment(3,true))
  assert.deepEqual(model.state.b,{kind:'set',id:set})
  assert.deepEqual(model.state.c,{kind:'all'})
  assert.deepEqual(model.siteKeys,new Set([key('S2'),key('S3'),key('S4')]))
  expectAllColumnsPartitionC(model)
  model.select('c',{kind:'off'})
  assert.deepEqual(model.siteKeys,new Set([key('S2'),key('S3')]))
  const off=filterStatus(model,['b','a','c'],upper,'Late','late')
  assert.equal(off.active,true)
  assert.match(off.text,/Filtering by A \+ B · 2 \/ 5 sites selected.*B: K-LATE · KinaseLib · A: late · C: off/)
  model.setGlobalOff(true)
  assert.deepEqual(model.siteKeys,new Set(sites.map(site=>key(site.site))))
  const globallyOff=filterStatus(model,['b','a','c'],upper,'Late','late')
  assert.equal(globallyOff.active,false)
  assert.match(globallyOff.text,/All filtering off · 5 \/ 5 sites shown · saved filters would select 2/)
})
