import { selectionLabel } from './membership.js'
import type { FilterBranch, FilterModel } from './filtering.js'

/** Pure projection for the compact status bar; no control or plot state participates. */
export function filterStatus(model: FilterModel, branches: readonly FilterBranch[],
  displayedContrast: string, bResult: string, bContrast: string): {text:string; active:boolean} {
  const state=model.state
  const total=model.universeSize.toLocaleString()
  const selected=state.showAll? `Showing all ${total} measured sites (filters paused)`
    :`${model.siteKeys.size.toLocaleString()} / ${total} sites selected`
  const choices=branches.filter(branch=>branch!=='b'||model.includeB)
    .map(branch=>`${branch.toUpperCase()}: ${branch==='c'&&state.c.kind==='all'
      ? 'all (union)' : selectionLabel(model.get(branch),state[branch])}`)
  const properties=model.properties.filter(set=>set.enabled)
    .map(set=>`${set.id}: ${set.label.slice(set.id.length+1).replaceAll('_',' ')}`)
  const active=state.showAll?[]:[
    ...(state.a.kind==='off'?[]:['A']),
    ...(model.includeB&&state.b.kind!=='off'?['B']:[]),
    ...(state.c.kind!=='all'||properties.length?['C']:[]),
  ]
  const activity=state.showAll?'Filters paused'
    :active.length?`Filtering by ${active.join(' + ')}`:'No active filters'
  const context=model.includeB&&state.b.kind!=='off'&&bContrast
    ? [`B filter: ${bResult} · ${bContrast}`] : []
  const estimate=model.properties.some(set=>set.id==='estimate'&&set.enabled)
    ? [`Estimate contrast: ${displayedContrast}`] : []
  return {text:`${activity} · ${selected} · ${[...choices,...context,...properties,...estimate].join(' · ')}`,
    active:active.length>0}
}
