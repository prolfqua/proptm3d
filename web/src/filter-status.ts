import { selectionLabel } from './membership.js'
import type { FilterBranch, FilterModel } from './filtering.js'

/** Pure projection for the compact status bar; no control or plot state participates. */
export function filterStatus(model: FilterModel, branches: readonly FilterBranch[],
  displayedContrast: string, bResult: string, bContrast: string): {text:string; active:boolean} {
  const state=model.state
  const total=model.universeSize.toLocaleString()
  const selected=state.globalOff
    ? `${total} / ${total} sites shown · saved filters would select ${model.filteredSiteKeys.size.toLocaleString()}`
    : `${model.siteKeys.size.toLocaleString()} / ${total} sites selected`
  const choices=branches.filter(branch=>branch!=='b'||model.includeB)
    .map(branch=>`${branch.toUpperCase()}: ${branch==='c'&&state.c.kind==='all'
      ? 'all (union)' : selectionLabel(model.get(branch),state[branch])}`)
  const properties=model.properties.filter(set=>set.enabled)
    .map(set=>`${set.id}: ${set.label.slice(set.id.length+1).replaceAll('_',' ')}`)
  const active=state.globalOff?[]:[
    ...(state.a.kind==='off'?[]:['A']),
    ...(model.includeB&&state.b.kind!=='off'?['B']:[]),
    ...(state.c.kind!=='off' && (state.c.kind!=='all'||properties.length)?['C']:[]),
  ]
  const activity=state.globalOff?'All filtering off'
    :active.length?`Filtering by ${active.join(' + ')}`:'No active filters'
  const context=!state.globalOff&&model.includeB&&state.b.kind!=='off'&&bContrast
    ? [`B filter: ${bResult} · ${bContrast}`] : []
  const estimate=state.c.kind!=='off'&&!state.globalOff&&model.properties.some(set=>set.id==='estimate'&&set.enabled)
    ? [`Estimate contrast: ${displayedContrast}`] : []
  const propertySummary=state.c.kind==='off'||state.globalOff
    ? properties.length?[`C settings (inactive): ${properties.join(', ')}`]:[] : properties
  return {text:`${activity} · ${selected} · ${[...choices,...context,...propertySummary,...estimate].join(' · ')}`,
    active:active.length>0}
}
