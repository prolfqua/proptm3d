import { isSignificant } from './summary.js'
import { sequenceSetKey, sequenceSetsAtFdr } from './gsea.js'
import { computeUpSet, resolveSelection, selectionLabel, siteIdentity,
  type SetSelection, type SiteSet, type UpSetModel } from './upset.js'
import type { AppData, GseaPayload, Thresholds } from './types.js'
import type { StructuralFilters } from './structural.js'
import type { EstimateType } from './detail.js'

export function contrastSets(data: AppData, thresholds: Thresholds): SiteSet[] {
  const sets = new Map(data.run.contrasts.map(id => [id, new Set<string>()]))
  for (const row of data.siteIndex) {
    if (isSignificant(row, thresholds)) sets.get(row.contrast)?.add(siteIdentity(row.protein_Id,row.site))
  }
  return [...sets].map(([id,siteKeys])=>({id,label:id,siteKeys,enabled:true}))
}

export function sequenceSets(payload: GseaPayload, fdr: number, leading: boolean): SiteSet[] {
  const sets = new Map(sequenceSetsAtFdr(payload,fdr).map(s=>[sequenceSetKey(s.source,s.sequence_set),
    {id:sequenceSetKey(s.source,s.sequence_set),label:`${s.sequence_set} · ${s.source}`,siteKeys:new Set<string>(),enabled:true}]))
  for (const row of payload.memberships) {
    if (!leading || row.is_leading_edge) sets.get(sequenceSetKey(row.source,row.sequence_set))
      ?.siteKeys.add(siteIdentity(row.protein_Id,row.site))
  }
  return [...sets.values()]
}

export function propertySets(data: AppData, contrast: string, estimate: EstimateType, structural: StructuralFilters): SiteSet[] {
  const estimateKeys = new Set(data.siteIndex.filter(r=>r.contrast===contrast && r.site_estimate_type===estimate)
    .map(r=>siteIdentity(r.protein_Id,r.site)))
  return [{id:'estimate',label:`estimate_${estimate}`,siteKeys:estimateKeys,enabled:estimate!=='all'},
    ...(['exposure','region'] as const).map(id=>({id,label:`${id}_${structural[id]}`,enabled:structural[id]!=='all',
      siteKeys:new Set(data.sites.filter(s=>s.structure[id]===structural[id]).map(s=>siteIdentity(s.protein_Id,s.site)))}))]
}

/** Keep C's full union and set sizes, but display only useful exact combinations. */
export function relevantCombinedIntersections(model: UpSetModel): UpSetModel {
  const active = model.sets.filter(set=>set.enabled)
  const properties = active.filter(set=>['estimate','exposure','region'].includes(set.id)).map(set=>set.id)
  const selections = active.filter(set=>['contrast_selection','sequence_set_selection'].includes(set.id)).map(set=>set.id)
  return {...model,intersections:model.intersections.filter(group=>
    properties.every(id=>group.setIds.includes(id))
    && (!selections.length || selections.some(id=>group.setIds.includes(id))))}
}

export class FilterSelection {
  a: SetSelection = {kind:'all'}
  b: SetSelection = {kind:'off'}
  c: SetSelection = {kind:'all'}
  showAll = false

  resetCombined(): boolean {
    const changed = this.c.kind !== 'all'
    this.c = {kind:'all'}
    return changed
  }

  reconcileB(previous: UpSetModel, next: UpSetModel, contextChanged: boolean): boolean {
    if (this.b.kind === 'off') return false
    const eligibleChanged = JSON.stringify(previous.sets.map(s=>s.id).sort()) !== JSON.stringify(next.sets.map(s=>s.id).sort())
    if (contextChanged || (this.b.kind === 'set' && !next.sets.some(s=>this.b.kind==='set'&&s.id===this.b.id))
      || (this.b.kind === 'intersection' && eligibleChanged)) {
      this.b = {kind:'all'}
      return true
    }
    return false
  }

  combine(a: UpSetModel, b: UpSetModel, properties: SiteSet[], includeB = true): UpSetModel {
    const branch = (id: string, model: UpSetModel, selection: SetSelection): SiteSet => ({id,
      label:`${id}_${selectionLabel(model,selection)}`,siteKeys:resolveSelection(model,selection)??new Set(),
      enabled:selection.kind!=='off'})
    return computeUpSet([branch('contrast_selection',a,this.a),
      ...(includeB?[branch('sequence_set_selection',b,this.b)]:[]),...properties])
  }

  effective(c: UpSetModel, universe: ReadonlySet<string>): ReadonlySet<string> {
    return this.showAll || !c.sets.some(s=>s.enabled) ? universe : resolveSelection(c,this.c)!
  }
}
