export interface SetDefinition {
  readonly id: string
  readonly label: string
  readonly enabled: boolean
}
export type MembershipPair = readonly [siteKey: string, setId: string]
export interface SiteSet extends SetDefinition { readonly siteKeys: ReadonlySet<string> }
export type SetSelection = { kind: 'off' | 'all' }
  | { kind: 'set'; id: string }
  | { kind: 'intersection'; ids: readonly string[] }
export interface UpSetIntersection {
  readonly key: string
  readonly setIds: readonly string[]
  readonly siteKeys: ReadonlySet<string>
}
export interface UpSetModel {
  readonly sets: readonly SiteSet[]
  readonly union: ReadonlySet<string>
  readonly intersections: readonly UpSetIntersection[]
}

export const siteIdentity = (proteinId: string, site: string): string => `${proteinId}\u0000${site}`
export const intersectionKey = (ids: readonly string[]): string => JSON.stringify([...ids].sort())

/** Evaluate a deduplicated site–set relation and materialize only observed exact combinations. */
export function computeUpSet(definitions: readonly SetDefinition[], pairs: Iterable<MembershipPair>): UpSetModel {
  const sets = definitions.map(({id,label,enabled})=>({id,label,enabled,siteKeys:new Set<string>()}))
  const byId = new Map(sets.map(set=>[set.id,set]))
  if (byId.size !== sets.length) throw new Error('Duplicate set definition')
  const siteSets = new Map<string, Set<string>>()
  for (const [siteKey,id] of pairs) {
    const set = byId.get(id)
    if (!set) throw new Error(`Membership references unknown set: ${id}`)
    if (!set.enabled || set.siteKeys.has(siteKey)) continue
    set.siteKeys.add(siteKey)
    if (!siteSets.has(siteKey)) siteSets.set(siteKey,new Set())
    siteSets.get(siteKey)!.add(id)
  }
  const groups = new Map<string,{key:string;setIds:string[];siteKeys:Set<string>}>()
  for (const [siteKey,ids] of siteSets) {
    const setIds=[...ids]
    const key=intersectionKey(setIds)
    if (!groups.has(key)) groups.set(key,{key,setIds,siteKeys:new Set<string>()})
    groups.get(key)!.siteKeys.add(siteKey)
  }
  return {sets,union:new Set(siteSets.keys()),intersections:[...groups.values()]
    .sort((a,b)=>b.siteKeys.size-a.siteKeys.size || a.key.localeCompare(b.key))}
}

/** null means disabled; an empty set means enabled with no matching sites. */
export function resolveSelection(model: UpSetModel, selection: SetSelection): ReadonlySet<string> | null {
  if (selection.kind === 'off') return null
  if (selection.kind === 'all') return model.union
  if (selection.kind === 'set') return model.sets.find(s=>s.id===selection.id)?.siteKeys ?? new Set()
  if (selection.kind === 'intersection') {
    return model.intersections.find(s=>s.key===intersectionKey(selection.ids))?.siteKeys ?? new Set()
  }
  return new Set()
}

export function selectionLabel(model: UpSetModel, selection: SetSelection): string {
  const label=(id:string)=>model.sets.find(s=>s.id===id)?.label ?? id
  if (selection.kind === 'set') return label(selection.id)
  if (selection.kind === 'intersection') return selection.ids.map(label).join(' ∩ ')+' (exact)'
  return selection.kind
}

export function rowsForSites<T extends { protein_Id: string; site: string }>(
  rows: readonly T[], keys: ReadonlySet<string>,
): T[] {
  return rows.filter(row=>keys.has(siteIdentity(row.protein_Id,row.site)))
}
