import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UNAVAILABLE_STRUCTURE } from '../src/structural.js'
import { contrastRelation } from '../src/filtering.js'
import { computeUpSet as evaluate, displayedUpSet, intersectionDegrees, intersectionsAtDegree, rankedUpSetDisplay, resolveSelection, rowsForSites, siteIdentity, type SiteSet } from '../src/upset-model.js'
import { buildUpSetFigure, UpSetPlot } from '../src/upset.js'
import type { AppData, SiteIndexRow } from '../src/types.js'

function computeUpSet(sets: SiteSet[]) {
  return evaluate(sets,sets.flatMap(set=>[...set.siteKeys].map(site=>[site,set.id] as const)))
}

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


test('A uses strict significance; whole sets include shared sites and identity keeps all contrast rows', () => {
  const rows = [row(),row({contrast:'B'}),row({contrast:'C',fdr:.4}),
    row({site:'T20',effect:1}),row({site:'T21',fdr:.05}),row({site:'S30'}),row({site:'S30'})]
  const data = {siteIndex:rows,run:{contrasts:['A','B','C']}} as AppData
  const model = contrastRelation(data,{fdr:.05,absEffect:1})
  assert.deepEqual(model.sets.map(s=>s.siteKeys.size),[2,1,0])
  const shared = resolveSelection(model,{kind:'intersection',ids:['A','B']})!
  assert.deepEqual(shared,new Set([siteIdentity('P1','S10')]))
  assert.equal(rowsForSites(rows,shared).length,3)
  assert.equal(resolveSelection(model,{kind:'set',id:'A'})!.size,2)
})

test('one renderer exposes whole-set bars, exact columns, and 50-column pages', () => {
  const sets = Array.from({length:124},(_,i)=>({id:`s${i}`,label:`Set ${i}`,siteKeys:new Set([`p\u0000${i}`]),enabled:true}))
  const model=computeUpSet(sets)
  const first=buildUpSetFigure(model,{kind:'set',id:'s0'})
  assert.deepEqual((first.data[1].customdata as unknown[])[0],{kind:'set',id:'s0'})
  assert.equal((first.data[0].customdata as unknown[]).length,50)
  // Plotly's `skip` suppresses picking as well as hover text; matrix dots must stay clickable.
  for (const trace of first.data.slice(2)) {
    assert.equal(trace.hoverinfo,'none')
    assert.ok((trace.customdata as unknown[]).length>0)
  }
  const third=buildUpSetFigure(model,{kind:'all'},2)
  assert.equal((third.data[0].customdata as unknown[]).length,24)
  assert.equal(model.union.size,124)
  const axis=(first.layout as {yaxis:{domain:number[]}}).yaxis
  assert.ok(axis.domain[0]<axis.domain[1] && axis.domain[1]<=1,
    'the intersection histogram stays above a tall, scrollable membership matrix')
})

test('Selected/All display focuses columns or rows without changing selection or exact memberships', () => {
  const model=computeUpSet([
    {id:'A',label:'A',siteKeys:new Set(['a','ab','abc']),enabled:true},
    {id:'B',label:'B',siteKeys:new Set(['ab','abc']),enabled:true},
    {id:'C',label:'C',siteKeys:new Set(['abc','c']),enabled:true},
  ])
  const whole={kind:'set',id:'A'} as const
  const exact={kind:'intersection',ids:['A','B']} as const
  const wholeView=displayedUpSet(model,whole,'selected')
  assert.equal(wholeView.sets.length,3)
  assert.deepEqual(wholeView.intersections.map(group=>group.siteKeys.size),[1,1,1])
  assert.ok(wholeView.intersections.every(group=>group.setIds.includes('A')))
  assert.deepEqual((buildUpSetFigure(model,whole,0,true,0,'selected').data[0].y),[1,1,1])
  const exactView=displayedUpSet(model,exact,'selected')
  assert.deepEqual(exactView.sets.map(set=>set.id),['A','B'])
  assert.equal(exactView.intersections.length,model.intersections.length)
  const figure=buildUpSetFigure(model,exact,0,true,0,'selected')
  assert.equal((figure.data[1].customdata as unknown[]).length,2)
  assert.deepEqual(figure.data[1].x,[3,2], 'focused rows retain their complete set sizes')
  assert.ok((figure.data[0].customdata as Array<{ids:string[]}>).some(choice=>choice.ids.includes('C')),
    'hidden rows remain in exact column identities')
  assert.deepEqual(displayedUpSet(model,exact,'all').sets,model.sets)
  assert.deepEqual(displayedUpSet(model,whole,'all').intersections,model.intersections)
  assert.deepEqual(intersectionDegrees(model,whole,'selected'),[1,2,3])
  assert.deepEqual(intersectionDegrees(model,{kind:'set',id:'C'},'selected'),[1,3])
  assert.deepEqual(resolveSelection(model,whole),new Set(['a','ab','abc']))
  assert.deepEqual(resolveSelection(model,exact),new Set(['ab']))
  assert.equal(model.sets.length,3)
  assert.equal(model.intersections.length,4)
})

test('the reusable UpSet plot owns its Selected/All view state', () => {
  let changes=0
  const plot=new UpSetPlot({} as HTMLDivElement,'Test UpSet',()=>{},()=>{changes++})
  assert.equal(plot.mode,'selected')
  plot.setView('all')
  assert.equal(plot.mode,'all')
  assert.equal(changes,1)
  plot.setView('all')
  assert.equal(changes,1)
  plot.focusSelection()
  assert.equal(plot.mode,'selected')
  assert.equal(changes,1,'bar selection redraws through its selection callback')
})

test('shared UpSet selected bars count only their intersections at the chosen dot count', () => {
  const model=computeUpSet([
    {id:'A',label:'A',siteKeys:new Set(['a','ab1','ab2','abc']),enabled:true},
    {id:'B',label:'B',siteKeys:new Set(['ab1','ab2','abc','b']),enabled:true},
    {id:'C',label:'C',siteKeys:new Set(['abc','c']),enabled:true},
    {id:'D',label:'D',siteKeys:new Set(['d']),enabled:true},
  ])
  const selected={kind:'set',id:'A'} as const
  const all=buildUpSetFigure(model,selected,0,true,0,'selected')
  assert.deepEqual(all.data[1].customdata,[{kind:'set',id:'A'},{kind:'set',id:'B'},{kind:'set',id:'C'}])
  assert.deepEqual(all.data[1].x,[4,3,1])
  assert.equal((all.layout as {xaxis3:{title:{text:string}}}).xaxis3.title.text,'Overlap size')
  const pairs=buildUpSetFigure(model,selected,0,true,2,'selected')
  assert.deepEqual(pairs.data[1].customdata,[{kind:'set',id:'A'},{kind:'set',id:'B'}])
  assert.deepEqual(pairs.data[1].x,[2,2])
  assert.deepEqual(pairs.data[0].y,[2])
  const exclusive=buildUpSetFigure(model,selected,0,true,1,'selected')
  assert.deepEqual(exclusive.data[1].customdata,[{kind:'set',id:'A'}])
  assert.deepEqual(exclusive.data[1].x,[1])
  assert.deepEqual(resolveSelection(model,selected),new Set(['a','ab1','ab2','abc']))
  assert.deepEqual(buildUpSetFigure(model,selected,0,true,2,'all').data[1].x,[4,4,2,1])
})

test('selected overlap bars include every matching intersection, not only the current page', () => {
  const sites=Array.from({length:51},(_,i)=>`site-${i}`)
  const model=computeUpSet([
    {id:'anchor',label:'Anchor',siteKeys:new Set(sites),enabled:true},
    ...sites.map((site,i)=>({id:`s${i}`,label:`Set ${i}`,siteKeys:new Set([site]),enabled:true})),
  ])
  const selection={kind:'set',id:'anchor'} as const
  const first=buildUpSetFigure(model,selection,0,false,2,'selected')
  const second=buildUpSetFigure(model,selection,1,false,2,'selected')
  assert.equal((first.data[0].customdata as unknown[]).length,50)
  assert.equal((second.data[0].customdata as unknown[]).length,1)
  assert.deepEqual(first.data[1].x,second.data[1].x)
  assert.equal((first.data[1].x as number[])[0],51)
})

test('A/B rows sort largest first without changing selection identities or memberships', () => {
  const model=computeUpSet([
    {id:'small',label:'Small',siteKeys:new Set(['s1']),enabled:true},
    {id:'large',label:'Large',siteKeys:new Set(['s1','s2','s3']),enabled:true},
  ])
  const figure=buildUpSetFigure(model,{kind:'set',id:'small'})
  assert.deepEqual(figure.data[1].x,[3,1])
  assert.deepEqual(figure.data[1].customdata,[{kind:'set',id:'large'},{kind:'set',id:'small'}])
  const labels=(figure.layout.annotations as Array<{text:string;captureevents:boolean}>).slice(0,2)
  assert.deepEqual(labels.map(({text,captureevents})=>({text,captureevents})),
    [{text:'Large',captureevents:true},{text:'Small',captureevents:true}])
  assert.deepEqual(model.sets.map(s=>s.id),['small','large'])
  assert.deepEqual(resolveSelection(model,{kind:'set',id:'small'}),new Set(['s1']))
  const matrix=figure.data[3]
  assert.deepEqual(matrix.y,[0,0,1])
})

test('C keeps semantic row order, enables whole-set picking and prints small counts outside bars', () => {
  const model=computeUpSet([
    {id:'contrast',label:'contrast_off',siteKeys:new Set<string>(),enabled:false},
    {id:'set',label:'sequence_set_CDK6',siteKeys:new Set(['s1']),enabled:true},
    {id:'estimate',label:'estimate_observed',siteKeys:new Set(['s1','s2','s3']),enabled:true},
  ])
  const bars=buildUpSetFigure(model,{kind:'all'},0,false).data[1]
  assert.deepEqual(bars.customdata,[null,{kind:'set',id:'set'},{kind:'set',id:'estimate'}])
  assert.deepEqual(bars.x,[0,1,3])
  assert.equal(bars.textposition,'outside')
  assert.equal(bars.textangle,0)
  assert.equal(bars.cliponaxis,false)
  assert.notEqual((bars.textfont as {color:string}).color,'#ffffff')
  const annotations=buildUpSetFigure(model,{kind:'all'},0,false).layout.annotations as Array<{captureevents:boolean}>
  assert.deepEqual(annotations.slice(0,3).map(a=>a.captureevents),[false,true,true])
})

test('C uses the same conditional overlap bars while preserving its All-view row order', () => {
  const model=computeUpSet([
    {id:'contrast',label:'contrast_off',siteKeys:new Set<string>(),enabled:false},
    {id:'set',label:'sequence_set_all',siteKeys:new Set(['s1','s2','s3']),enabled:true},
    {id:'estimate',label:'estimate_observed',siteKeys:new Set(['s2','s3','s4']),enabled:true},
    {id:'exposure',label:'exposure_exposed',siteKeys:new Set(['s3','s5']),enabled:true},
  ])
  const selection={kind:'set',id:'estimate'} as const
  const focused=buildUpSetFigure(model,selection,0,false,0,'selected')
  assert.deepEqual(focused.data[1].customdata,[
    {kind:'set',id:'estimate'},{kind:'set',id:'set'},{kind:'set',id:'exposure'},
  ])
  assert.deepEqual(focused.data[1].x,[3,2,1])
  assert.equal((focused.layout as {xaxis3:{title:{text:string}}}).xaxis3.title.text,'Overlap size')
  const all=buildUpSetFigure(model,selection,0,false,0,'all')
  assert.deepEqual(all.data[1].customdata,[
    null,{kind:'set',id:'set'},{kind:'set',id:'estimate'},{kind:'set',id:'exposure'},
  ])
  assert.deepEqual(all.data[1].x,[0,3,3,2])
  assert.deepEqual(resolveSelection(model,selection),new Set(['s2','s3','s4']))
})

test('dot count narrows exact columns, never whole-set membership or the active selection', () => {
  const model=computeUpSet([
    {id:'a',label:'A',siteKeys:new Set(['only-a','ab','abc']),enabled:true},
    {id:'b',label:'B',siteKeys:new Set(['ab','abc']),enabled:true},
    {id:'c',label:'C',siteKeys:new Set(['abc']),enabled:true},
  ])
  for (const degree of [1,2,3]) {
    const groups=intersectionsAtDegree(model,degree)
    assert.equal(groups.length,1)
    assert.equal(groups[0].setIds.length,degree)
  }
  const figure=buildUpSetFigure(model,{kind:'intersection',ids:['a','b']},0,true,1)
  assert.deepEqual(figure.data[0].customdata,[{kind:'intersection',ids:['a']}])
  assert.deepEqual(figure.data[1].x,[3,2,1])
  assert.deepEqual(resolveSelection(model,{kind:'intersection',ids:['a','b']}),new Set(['ab']))
  assert.deepEqual(resolveSelection(model,{kind:'set',id:'a'}),new Set(['only-a','ab','abc']))
  assert.equal(intersectionsAtDegree(model,0),model.intersections)
  assert.equal(model.union.size,3)
})

test('dot count is applied before paging and an empty degree is explicit', () => {
  const sets=Array.from({length:62},(_,i)=>({id:`s${i}`,label:`Set ${i}`,
    siteKeys:new Set([`exclusive-${i}`,`shared-${i}`]),enabled:true}))
  sets.push({id:'shared',label:'Shared',siteKeys:new Set(sets.map((_,i)=>`shared-${i}`)),enabled:true})
  const model=computeUpSet(sets)
  const second=buildUpSetFigure(model,{kind:'all'},1,true,2)
  const choices=second.data[0].customdata as {ids:string[]}[]
  assert.equal(choices.length,12)
  assert.ok(choices.every(c=>c.ids.length===2))
  assert.equal(intersectionsAtDegree(model,2).length,62)
  const empty=buildUpSetFigure(model,{kind:'all'},0,true,3)
  assert.deepEqual(empty.data[0].customdata,[])
  assert.match(JSON.stringify(empty.layout.annotations),/No intersections with 3 dots/)
  assert.equal(model.intersections.length,124)
})

test('dot-count choices contain only observed degrees, sorted and deduplicated across every page', () => {
  const sets=Array.from({length:62},(_,i)=>({id:`s${i}`,label:`Set ${i}`,
    siteKeys:new Set([`exclusive-${i}`,`another-${i}`, 'shared-by-all']),enabled:true}))
  sets[0].siteKeys.add('triple'); sets[1].siteKeys.add('triple'); sets[2].siteKeys.add('triple')
  const model=computeUpSet(sets)
  assert.ok(model.intersections.slice(0,50).every(group=>group.setIds.length===1))
  assert.deepEqual(intersectionDegrees(model),[1,3,62])
  assert.deepEqual(intersectionDegrees(computeUpSet([])),[])
  assert.deepEqual(intersectionDegrees(computeUpSet(sets.map(s=>({...s,enabled:false})))),[])
  assert.equal(model.union.size,126)
})

test('B rows rank by the largest visible exact intersection for one and two dots', () => {
  const ac=['ac1','ac2','ac3','ac4'], bc=['bc1','bc2']
  const model=computeUpSet([
    {id:'A',label:'A',siteKeys:new Set(['a1',...ac]),enabled:true},
    {id:'B',label:'B',siteKeys:new Set(['b1','b2','b3',...bc]),enabled:true},
    {id:'C',label:'C',siteKeys:new Set([...ac,...bc]),enabled:true},
  ])
  const ids=(degree:number)=>rankedUpSetDisplay(model,degree,null).sets.map(set=>set.id)
  assert.deepEqual(ids(1),['B','A','C'])
  assert.deepEqual(ids(2),['C','A','B'])
  assert.equal(model.union.size,10)
  assert.deepEqual(resolveSelection(model,{kind:'set',id:'A'}),new Set(['a1',...ac]))
})

test('B search moves matches first and shows their columns without changing exact membership', () => {
  const ac=['ac1','ac2','ac3','ac4'], bc=['bc1','bc2']
  const model=computeUpSet([
    {id:'A',label:'A',siteKeys:new Set(['a1',...ac]),enabled:true},
    {id:'B',label:'B',siteKeys:new Set(['b1','b2','b3',...bc]),enabled:true},
    {id:'C',label:'C',siteKeys:new Set([...ac,...bc]),enabled:true},
  ])
  const display=rankedUpSetDisplay(model,2,new Set(['B']))
  assert.deepEqual(display.sets.map(set=>set.id),['B','C','A'])
  assert.deepEqual(intersectionsAtDegree(display,2).map(group=>[...group.setIds].sort()),[['B','C']])
  assert.equal(display.union,model.union)
  assert.equal(display.sets.length,3,'other rows remain to show full exact membership')
  assert.deepEqual(resolveSelection(display,{kind:'intersection',ids:['B','C']}),new Set(bc))
  assert.equal(model.intersections.length,4)
  assert.equal(rankedUpSetDisplay(model,2,new Set(['missing'])).intersections.length,0)
})
