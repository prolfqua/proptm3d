import assert from 'node:assert/strict'
import test from 'node:test'
import { html } from 'lit'
import { buildDetailRows } from '../src/detail.js'
import { FilterModel, type EnrichmentInput } from '../src/filtering.js'
import { FilterPanel, renderFilters } from '../src/filter-panel.js'
import { gseaProfile, statsProfile, profileFor } from '../src/browser-profile.js'
import { gseaSiteTableRows } from '../src/gsea.js'
import { computeLogos } from '../src/logo.js'
import { ALL_STRUCTURES, UNAVAILABLE_STRUCTURE } from '../src/structural.js'
import { rowsForSites, siteIdentity, type SetSelection } from '../src/upset-model.js'
import type { AppData, GseaPayload, ProteinDetail } from '../src/types.js'

const thresholds = {fdr:0.05,absEffect:1}
const sites = ['S1','S2','S3','S4'].map((site,i)=>({
  protein_Id:'P1', site, accession:'P1', gene_name:'Gene', modAA:'S', posInProtein:i+1,
  SequenceWindow:'AAAAAAASAAAAAAA', has_measurement:true,
  structure: i===1||i===2 ? {...UNAVAILABLE_STRUCTURE,exposure:'exposed',region:'idr'} : UNAVAILABLE_STRUCTURE,
}))
const data = {run:{contrasts:['early','late']},sites,siteIndex:[
  {...sites[0],contrast:'early',effect:2,fdr:0.01,site_estimate_type:'observed',sequence_window:sites[0].SequenceWindow},
  {...sites[1],contrast:'early',effect:0.2,fdr:0.5,site_estimate_type:'observed',sequence_window:sites[1].SequenceWindow},
]} as unknown as AppData
const universe = new Set(sites.map(s=>siteIdentity(s.protein_Id,s.site)))
const enrichment: EnrichmentInput = {payload:null,fdr:0.05,leading:false,
  context:'result\u0000early',revision:1,status:'Ready',ready:true}
const emptyPayload={sequenceSets:[],memberships:[],curves:[]} as unknown as GseaPayload

test('filter collapse keeps context navigation and the current selection summary visible', () => {
  const view=renderFilters({a:html``,b:html``,c:html``},html``,gseaProfile)
  const markup=view.strings.join('')
  assert.ok(markup.indexOf('class="filter-navigation"')<markup.indexOf('id="toggle-filters"'))
  assert.ok(markup.indexOf('id="filter-summary"')<markup.indexOf('id="filter-body"'))
  assert.ok(!markup.includes('data-upset-view'), 'view controls are rendered by the shared UpSet plot')

  const {panel,el}=panelFixture()
  const summary=el('#filter-summary').textContent
  assert.match(summary,/Filtering by A/)
  assert.match(summary,/1 \/ 4 sites selected · A: all · C: all \(union\)/)
  el('#filter-body').hidden=false
  el('#toggle-filters').onclick()
  assert.equal(el('#filter-body').hidden,true)
  assert.equal(el('#filter-summary').textContent,summary)
  panel.model.setGlobalOff(true)
  panel.update(data,'early',{fdr:0.01,absEffect:1},'all',ALL_STRUCTURES,
    {...enrichment,revision:2})
  assert.match(el('#filter-summary').textContent,/All filtering off · 4 \/ 4 sites shown · saved filters would select 0/)
  panel.update(data,'early',{fdr:0.01,absEffect:1},'all',{exposure:'exposed',region:'idr'},
    {...enrichment,revision:3})
  assert.match(el('#filter-summary').textContent,/C settings \(inactive\): exposure: exposed, region: idr/)
  const withGsea={...data,run:{...data.run,gsea:{results:[{id:'result'}]}}} as AppData
  panel.model.setGlobalOff(false)
  panel.update(withGsea,'early',thresholds,'all',ALL_STRUCTURES,
    {...enrichment,payload:emptyPayload,context:'result\u0000late',revision:4})
  const choose=panel as unknown as {select:(branch:string,selection:SetSelection)=>void}
  choose.select('b',{kind:'all'})
  assert.match(el('#filter-summary').textContent,/B filter: result · late/)
})

test('filter warning names only the branches that currently affect results', () => {
  const {panel,el}=panelFixture()
  const choose=panel as unknown as {select:(branch:string,selection:SetSelection)=>void}
  choose.select('a',{kind:'off'})
  assert.match(el('#filter-summary').textContent,/No active filters/)
  panel.update(data,'early',thresholds,'all',{exposure:'exposed',region:'all'},
    {...enrichment,revision:2})
  assert.match(el('#filter-summary').textContent,/Filtering by C/)
  const withGsea={...data,run:{...data.run,gsea:{results:[{id:'result'}]}}} as AppData
  panel.update(withGsea,'early',thresholds,'all',{exposure:'exposed',region:'all'},
    {...enrichment,revision:3,payload:emptyPayload})
  choose.select('b',{kind:'all'})
  assert.match(el('#filter-summary').textContent,/Filtering by B \+ C/)
  choose.select('a',{kind:'all'})
  assert.match(el('#filter-summary').textContent,/Filtering by A \+ B \+ C/)
  panel.update(withGsea,'early',thresholds,'all',ALL_STRUCTURES,
    {...enrichment,revision:4,payload:emptyPayload})
  assert.match(el('#filter-summary').textContent,/Filtering by A \+ B/)
  choose.select('c',{kind:'off'})
  assert.match(el('#filter-summary').textContent,/Filtering by A \+ B.*C: off/)
  el('#toggle-filtering').onclick()
  assert.match(el('#filter-summary').textContent,/All filtering off/)
})

test('C union reaches tables, detail and logos without an implicit significance AND', () => {
  const model=new FilterModel()
  model.update(data,'early',thresholds,'all',{exposure:'exposed',region:'all'},enrichment)
  const selected=model.siteKeys
  assert.deepEqual(selected,new Set(['P1\u0000S1','P1\u0000S2','P1\u0000S3']))
  const detail = {sites:data.sites,results:data.siteIndex,context:[]} as unknown as ProteinDetail
  const rows = rowsForSites(buildDetailRows(detail,'early',thresholds),selected)
  const table = gseaSiteTableRows(null,'',data,'early',selected,'')
  assert.deepEqual(table.map(r=>r.site),rows.map(r=>r.site))
  assert.equal(table[1].effect,0.2)
  assert.equal(table[1].fdr,0.5)
  assert.equal(table[2].effect,null)
  assert.equal(table[2].fdr,null)
  assert.equal(table[2].rank,null)
  assert.equal(rows[2].estimate_status,'No result')
  const logos = computeLogos(rowsForSites(data.siteIndex,selected),'early')
  assert.equal(logos.upCount,2, 'low fold-change/high-FDR selected site still contributes')
  model.select('c',{kind:'intersection',ids:['exposure']})
  assert.deepEqual(model.siteKeys,new Set(['P1\u0000S2','P1\u0000S3']))
  model.select('a',{kind:'off'})
  model.update(data,'early',thresholds,'all',ALL_STRUCTURES,{...enrichment,revision:2})
  assert.deepEqual(model.siteKeys,universe)
})

test('estimate is a separate operand and includes no missing estimates; All disables it', () => {
  const model=new FilterModel()
  model.update(data,'early',thresholds,'observed',ALL_STRUCTURES,enrichment)
  const observed = model.properties[0]
  assert.deepEqual(observed.siteKeys,new Set(['P1\u0000S1','P1\u0000S2']))
  model.update(data,'early',thresholds,'all',ALL_STRUCTURES,{...enrichment,revision:2})
  assert.equal(model.properties[0].enabled,false)
})

// A minimal DOM surface exercises actual panel events without loading Plotly in Node.
function panelFixture(profile=gseaProfile) {
  const elements = new Map<string, any>()
  const el = (id:string): any => {
    if (!elements.has(id)) elements.set(id,{hidden:true,disabled:false,dataset:{},classList:{toggle(){}},setAttribute(){}})
    return elements.get(id)
  }
  const buttons = ['a','b','c'].flatMap(branch=>['off','all'].map(mode=>{
    const button = el(`${branch}-${mode}`)
    button.dataset={filterBranch:branch,filterMode:mode}
    return button
  }))
  const degrees = ['a','b'].map(branch=>{
    const control=el(`#filter-${branch}-degree`)
    control.dataset={upsetDegree:branch}
    return control
  })
  const root = {querySelector:el,querySelectorAll:(query:string)=>query==='[data-filter-branch]'?buttons
    : query==='[data-upset-degree]'?degrees:query.startsWith('#fdr-cutoff')?query.split(', ').map(el):[]}
  const panel = new FilterPanel(root as unknown as HTMLElement,new FilterModel(),()=>{},
    message=>assert.fail(message),profile)
  const update = (next=enrichment, cutoff=thresholds)=>panel.update(data,'early',cutoff,'all',ALL_STRUCTURES,next)
  update()
  return {panel,el,update,enrichment}
}

test('prepared capabilities select Stats or GSEA plugins with distinct UpSet compositions', () => {
  assert.equal(profileFor(data.run),statsProfile)
  const withGsea={...data.run,gsea:{results:[{id:'kinase'}]}} as AppData['run']
  assert.equal(profileFor(withGsea),gseaProfile)
  assert.deepEqual(statsProfile.branches,['a','c'])
  assert.deepEqual(gseaProfile.branches,['b','a','c'])
  assert.equal(statsProfile.enrichment,undefined)
  assert.ok(gseaProfile.enrichment)
  const statsView=renderFilters({a:html``,b:html``,c:html``},html``,statsProfile)
  const gseaView=renderFilters({a:html``,b:html``,c:html``},html``,gseaProfile)
  assert.equal((statsView.values.find(Array.isArray) as unknown[]).length,2)
  assert.equal((gseaView.values.find(Array.isArray) as unknown[]).length,3)
  assert.match(statsProfile.filterNotice,/A selects significant sites/)
  assert.doesNotMatch(statsProfile.filterNotice,/\bB\b|GSEA/)
  const {panel,el}=panelFixture(statsProfile)
  assert.match(el('#filter-summary').textContent,/A: all · C: all \(union\)/)
  assert.equal(panel.model.includeB,false)
  assert.deepEqual(Object.keys((panel as unknown as {plots:object}).plots).sort(),['a','c'])
})

test('upstream edits reset explicit C but preserve C Off and editable A/B', () => {
  const {panel,el,update} = panelFixture()
  panel.model.select('a',{kind:'set',id:'early'})
  panel.model.select('c',{kind:'intersection',ids:['contrast_selection']})
  update(undefined,{fdr:0.0001,absEffect:1})
  assert.deepEqual(panel.state.a,{kind:'set',id:'early'})
  assert.equal(panel.siteKeys.size,0)
  assert.deepEqual(panel.state.c,{kind:'all'})
  assert.match(el('#filter-notice').textContent,/C returned to all/)
  panel.model.select('c',{kind:'intersection',ids:['contrast_selection']})
  el('c-off').onclick()
  assert.equal(panel.siteKeys.size,0,'A remains effective when C is Off')
  assert.equal(el('#fdr-cutoff').disabled,false)
  assert.equal(el('#gsea-result').disabled,false)
  assert.equal(el('#displayed-contrast').disabled,false)
  assert.equal(el('c-off').dataset.filterMode,'off')
  update(undefined,{fdr:0.0002,absEffect:1})
  assert.deepEqual(panel.state.c,{kind:'off'})
  el('c-all').onclick()
  assert.equal(panel.siteKeys.size,0)
  assert.deepEqual(panel.state.c,{kind:'all'})
  assert.deepEqual(panel.state.a,{kind:'set',id:'early'})
  el('#toggle-filtering').onclick()
  assert.deepEqual(panel.siteKeys,universe)
  assert.equal(el('#filter-body').hidden,true)
  assert.equal(el('#toggle-filters').textContent,'Inspect filters')
  assert.match(el('#filter-c-label').textContent,/all · 0 sites if filtering on/)
  assert.match(el('#filter-summary').textContent,/saved filters would select 0/)
  assert.deepEqual(panel.state.a,{kind:'set',id:'early'})
  el('#toggle-filtering').onclick()
  assert.equal(panel.siteKeys.size,0)
  assert.equal(el('#filter-body').hidden,true)
  assert.equal(el('#toggle-filters').textContent,'Show filters')
})

test('loading/error/empty are distinct, and B Off stays usable', () => {
  const {panel,el}=panelFixture()
  assert.equal(el('#filter-b-card').hidden,true)
  assert.equal(panel.model.select('b',{kind:'all'}),false)
  const withGsea = {...data,run:{...data.run,gsea:{results:[{id:'result'}]}}} as AppData
  panel.update(withGsea,'early',thresholds,'all',ALL_STRUCTURES,{...enrichment,revision:2,
    payload:emptyPayload})
  panel.model.select('a',{kind:'off'})
  panel.model.select('b',{kind:'all'})
  panel.update(withGsea,'early',thresholds,'all',ALL_STRUCTURES,
    {...enrichment,revision:3,payload:null,ready:false,status:'Loading enrichment…'})
  assert.equal(panel.siteKeys.size,0)
  assert.equal(el('b-off').disabled,false)
  assert.equal(el('b-all').disabled,true)
  el('b-off').onclick()
  assert.deepEqual(panel.siteKeys,universe)
  panel.update(withGsea,'early',thresholds,'all',ALL_STRUCTURES,{...enrichment,revision:4,
    payload:emptyPayload})
  panel.model.select('b',{kind:'all'})
  assert.equal(panel.siteKeys.size,0, 'loaded empty B All must not bypass filtering')
  assert.equal(el('#filter-b-card').hidden,false)
})

test('C whole-set bars select shared members and reclick restores union without changing A/B', () => {
  const {panel}=panelFixture()
  panel.update(data,'early',thresholds,'all',{exposure:'exposed',region:'all'},
    {...enrichment,revision:2})
  const choose=panel as unknown as {select:(branch:string,selection:SetSelection)=>void}
  choose.select('c',{kind:'set',id:'exposure'})
  assert.deepEqual(panel.siteKeys,new Set(['P1\u0000S2','P1\u0000S3']))
  assert.equal(panel.state.a.kind,'all')
  assert.equal(panel.state.b.kind,'off')
  choose.select('c',{kind:'set',id:'exposure'})
  assert.deepEqual(panel.siteKeys,new Set(['P1\u0000S1','P1\u0000S2','P1\u0000S3']))
})

test('display degree changes preserve A/B/C selections and site counts', () => {
  const {panel,el}=panelFixture()
  panel.model.select('a',{kind:'set',id:'early'})
  panel.model.select('c',{kind:'intersection',ids:['contrast_selection']})
  const selections=JSON.stringify(panel.state), keys=panel.siteKeys, revision=panel.revision
  for (const branch of ['a','b']) {
    const control=el(`#filter-${branch}-degree`)
    control.value='2'; control.onchange()
    assert.equal(JSON.stringify(panel.state),selections)
    assert.equal(panel.siteKeys,keys)
    assert.equal(panel.revision,revision)
  }
  el('c-off').onclick()
  assert.equal(el('#effect-cutoff').disabled,false)
  assert.equal(el('#gsea-fdr').disabled,false)
  assert.equal(el('#filter-b-degree').disabled,false, 'display-only controls remain usable')
})

test('finding a sequence set is display-only and preserves A/B/C selections', () => {
  const {panel}=panelFixture()
  const selection=JSON.stringify(panel.state), keys=panel.siteKeys, revision=panel.revision
  panel.findSequenceSets(new Set(['KinaseLib\u0000CDK2']))
  assert.equal(JSON.stringify(panel.state),selection)
  assert.equal(panel.siteKeys,keys)
  assert.equal(panel.revision,revision)
  panel.findSequenceSets(null)
  assert.equal(JSON.stringify(panel.state),selection)
})
