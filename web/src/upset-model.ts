import type { SetSelection, SiteSet, UpSetIntersection, UpSetModel } from './membership.js'
export { computeUpSet, resolveSelection, selectionLabel, siteIdentity, intersectionKey, rowsForSites } from './membership.js'
export type { SetSelection, SiteSet, UpSetIntersection, UpSetModel } from './membership.js'
export type UpSetViewMode = 'selected' | 'all'
export const UPSET_PAGE_SIZE = 50

export function intersectionDegrees(model: UpSetModel, selection: SetSelection = {kind:'all'},
  mode: UpSetViewMode = 'all'): number[] {
  return [...new Set(displayedUpSet(model,selection,mode).intersections.map(group=>group.setIds.length))]
    .sort((a,b)=>a-b)
}

/** Display only: exact combinations are still computed over every enabled set. */
export function intersectionsAtDegree(model: UpSetModel, degree: number): readonly UpSetIntersection[] {
  return degree ? model.intersections.filter(group=>group.setIds.length===degree) : model.intersections
}

/** Display focus changes plotted counts, never the full model or exact-membership identities. */
export function displayedUpSet(model: UpSetModel, selection: SetSelection, mode: UpSetViewMode, degree = 0):
  {sets: readonly SiteSet[]; intersections: readonly UpSetIntersection[]; setSizes: ReadonlyMap<string, number> | null} {
  const intersections = (groups: readonly UpSetIntersection[]) => degree
    ? groups.filter(group=>group.setIds.length===degree) : groups
  if (mode === 'selected' && selection.kind === 'set') {
    const groups=intersections(model.intersections.filter(group=>group.setIds.includes(selection.id)))
    const setSizes=new Map<string, number>()
    for (const group of groups) {
      for (const id of group.setIds) setSizes.set(id,(setSizes.get(id)??0)+group.siteKeys.size)
    }
    const sets=model.sets.filter(set=>(setSizes.get(set.id)??0)>0).sort((a,b)=>
      Number(b.id===selection.id)-Number(a.id===selection.id)
      || (setSizes.get(b.id)??0)-(setSizes.get(a.id)??0) || a.id.localeCompare(b.id))
    return {sets,intersections:groups,setSizes}
  }
  if (mode === 'selected' && selection.kind === 'intersection') {
    return {sets:model.sets.filter(set=>selection.ids.includes(set.id)), intersections:intersections(model.intersections),setSizes:null}
  }
  return {sets:model.sets, intersections:intersections(model.intersections),setSizes:null}
}

/** Search and row ordering affect the UpSet display, never its exact site memberships. */
export function rankedUpSetDisplay(model: UpSetModel, degree: number, matches: ReadonlySet<string> | null): UpSetModel {
  const intersections = matches === null ? model.intersections
    : model.intersections.filter(group=>group.setIds.some(id=>matches.has(id)))
  const scores = new Map<string,{largest:number,total:number}>()
  for (const group of intersections) {
    if (degree && group.setIds.length!==degree) continue
    for (const id of group.setIds) {
      const score=scores.get(id)??{largest:0,total:0}
      score.largest=Math.max(score.largest,group.siteKeys.size)
      score.total+=group.siteKeys.size
      scores.set(id,score)
    }
  }
  const sets=[...model.sets].sort((a,b)=>{
    const match=(matches?.has(b.id)?1:0)-(matches?.has(a.id)?1:0)
    if (match) return match
    if (degree) {
      const largest=(scores.get(b.id)?.largest??0)-(scores.get(a.id)?.largest??0)
      if (largest) return largest
      const total=(scores.get(b.id)?.total??0)-(scores.get(a.id)?.total??0)
      if (total) return total
    }
    return b.siteKeys.size-a.siteKeys.size || a.id.localeCompare(b.id)
  })
  return {...model,sets,intersections}
}
