import assert from 'node:assert/strict'
import test from 'node:test'
import { html } from 'lit'
import { buildDetailRows } from '../src/detail.js'
import { contrastSets, FilterSelection, propertySets } from '../src/filtering.js'
import { FilterPanel, renderFilters, type EnrichmentSets } from '../src/filter-panel.js'
import { gseaSiteTableRows } from '../src/gsea.js'
import { computeLogos } from '../src/logo.js'
import { ALL_STRUCTURES, UNAVAILABLE_STRUCTURE } from '../src/structural.js'
import { computeUpSet, rowsForSites, siteIdentity } from '../src/upset.js'
import type { SetSelection } from '../src/upset.js'
import type { AppData, ProteinDetail } from '../src/types.js'

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

test('filter collapse keeps context navigation and the current selection summary visible', () => {
  const view=renderFilters({a:html``,b:html``,c:html``},html``)
  const markup=view.strings.join('')
  assert.ok(markup.indexOf('id="filter-summary"')<markup.indexOf('id="filter-body"'))
  assert.ok(markup.indexOf('class="filter-navigation"')<markup.indexOf('id="filter-body"'))
  assert.ok(!markup.includes('data-upset-view'), 'view controls are rendered by the shared UpSet plot')

  const {panel,el}=panelFixture()
  const summary=el('#filter-summary').textContent
  assert.match(summary,/1 \/ 4 sites selected · A: all · C: all/)
  el('#filter-body').hidden=false
  el('#toggle-filters').onclick()
  assert.equal(el('#filter-body').hidden,true)
  assert.equal(el('#filter-summary').textContent,summary)
  panel.state.showAll=true
  panel.update(data,'early',{fdr:0.01,absEffect:1},'all',ALL_STRUCTURES,
    {sets:[],context:'result\u0000early',revision:2,status:'Ready',ready:true})
  assert.match(el('#filter-summary').textContent,/Showing all 4 measured sites \(filters paused\)/)
  panel.update(data,'early',{fdr:0.01,absEffect:1},'all',{exposure:'exposed',region:'idr'},
    {sets:[],context:'result\u0000early',revision:3,status:'Ready',ready:true})
  assert.match(el('#filter-summary').textContent,/exposure: exposed · region: idr/)
})

test('C union reaches tables, detail and logos without an implicit significance AND', () => {
  const state = new FilterSelection()
  const a = computeUpSet(contrastSets(data,thresholds))
  const props = propertySets(data,'early','all',{exposure:'exposed',region:'all'})
  const c = state.combine(a,computeUpSet([]),props,false)
  const selected = state.effective(c,universe)
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
  state.c={kind:'intersection',ids:['exposure']}
  assert.deepEqual(state.effective(c,universe),new Set(['P1\u0000S2','P1\u0000S3']))
  state.a={kind:'off'}
  assert.deepEqual(state.effective(state.combine(a,computeUpSet([]),propertySets(data,'early','all',ALL_STRUCTURES),false),universe),universe)
})

test('estimate is a separate operand and includes no missing estimates; All disables it', () => {
  const observed = propertySets(data,'early','observed',ALL_STRUCTURES)[0]
  assert.deepEqual(observed.siteKeys,new Set(['P1\u0000S1','P1\u0000S2']))
  assert.equal(propertySets(data,'early','all',ALL_STRUCTURES)[0].enabled,false)
})

// A minimal DOM surface exercises actual panel events without loading Plotly in Node.
function panelFixture() {
  const elements = new Map<string, any>()
  const el = (id:string): any => {
    if (!elements.has(id)) elements.set(id,{hidden:true,disabled:false,dataset:{},classList:{toggle(){}},setAttribute(){}})
    return elements.get(id)
  }
  const buttons = ['a','b'].flatMap(branch=>['off','all'].map(mode=>{
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
  const panel = new FilterPanel(root as unknown as HTMLElement,()=>{},()=>{},message=>assert.fail(message))
  const enrichment: EnrichmentSets = {sets:[],context:'result\u0000early',revision:1,status:'Ready',ready:true}
  const update = (next=enrichment, cutoff=thresholds)=>panel.update(data,'early',cutoff,'all',ALL_STRUCTURES,next)
  update()
  return {panel,el,update,enrichment}
}

test('upstream edits reset C, preserve empty A, and show-all suspends only filter editing', () => {
  const {panel,el,update} = panelFixture()
  panel.state.a={kind:'set',id:'early'}
  panel.state.c={kind:'intersection',ids:['contrast_selection']}
  update(undefined,{fdr:0.0001,absEffect:1})
  assert.deepEqual(panel.state.a,{kind:'set',id:'early'})
  assert.equal(panel.siteKeys.size,0)
  assert.equal(panel.state.c.kind,'all')
  assert.match(el('#filter-notice').textContent,/C returned to all/)
  panel.state.c={kind:'intersection',ids:['contrast_selection']}
  el('#show-all-sites').onchange({target:{checked:true}})
  assert.deepEqual(panel.siteKeys,universe)
  assert.equal(el('#fdr-cutoff').disabled,true)
  assert.equal(el('#gsea-result').disabled,false)
  assert.equal(el('#displayed-contrast').disabled,false)
  el('#show-all-sites').onchange({target:{checked:false}})
  assert.equal(panel.siteKeys.size,0)
  assert.equal(panel.state.c.kind,'intersection')
  el('#clear-c').onclick()
  assert.equal(panel.state.c.kind,'all')
  assert.deepEqual(panel.state.a,{kind:'set',id:'early'})
})

test('loading/error/empty are distinct, B Off stays usable and stats-only omits B', () => {
  const {panel,el,update,enrichment} = panelFixture()
  assert.equal(el('#filter-b-card').hidden,true)
  panel.state.a={kind:'off'}
  panel.state.b={kind:'all'}
  update({...enrichment,revision:2,ready:false,status:'Loading enrichment…'})
  assert.equal(panel.siteKeys.size,0)
  assert.equal(el('b-off').disabled,false)
  assert.equal(el('b-all').disabled,true)
  el('b-off').onclick()
  assert.deepEqual(panel.siteKeys,universe)
  panel.state.b={kind:'all'}
  const withGsea = {...data,run:{...data.run,gsea:{results:[{id:'result'}]}}} as AppData
  panel.update(withGsea,'early',thresholds,'all',ALL_STRUCTURES,{...enrichment,revision:3})
  assert.equal(panel.siteKeys.size,0, 'loaded empty B All must not bypass filtering')
  assert.equal(el('#filter-b-card').hidden,false)
})

test('C whole-set bars select shared members and reclick restores union without changing A/B', () => {
  const {panel}=panelFixture()
  panel.update(data,'early',thresholds,'all',{exposure:'exposed',region:'all'},
    {sets:[],context:'result\u0000early',revision:2,status:'Ready',ready:true})
  const choose=panel as unknown as {select:(branch:string,selection:SetSelection)=>void}
  choose.select('c',{kind:'set',id:'exposure'})
  assert.deepEqual(panel.siteKeys,new Set(['P1\u0000S2','P1\u0000S3']))
  assert.equal(panel.state.a.kind,'all')
  assert.equal(panel.state.b.kind,'off')
  choose.select('c',{kind:'set',id:'exposure'})
  assert.deepEqual(panel.siteKeys,new Set(['P1\u0000S1','P1\u0000S2','P1\u0000S3']))
})

test('display degree changes preserve A/B/C selections, site counts and Show all', () => {
  const {panel,el}=panelFixture()
  panel.state.a={kind:'set',id:'early'}
  panel.state.c={kind:'intersection',ids:['contrast_selection']}
  const selections=JSON.stringify(panel.state), keys=panel.siteKeys, revision=panel.revision
  for (const branch of ['a','b']) {
    const control=el(`#filter-${branch}-degree`)
    control.value='2'; control.onchange()
    assert.equal(JSON.stringify(panel.state),selections)
    assert.equal(panel.siteKeys,keys)
    assert.equal(panel.revision,revision)
  }
  el('#show-all-sites').onchange({target:{checked:true}})
  assert.equal(el('#effect-cutoff').disabled,true)
  assert.equal(el('#gsea-fdr').disabled,true)
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
