import { isSignificant } from './summary.js'
import { sequenceSetKey, sequenceSetsAtFdr } from './gsea.js'
import { computeUpSet, resolveSelection, selectionLabel, siteIdentity,
  type MembershipPair, type SetDefinition, type SetSelection, type SiteSet, type UpSetModel } from './membership.js'
import type { AppData, GseaPayload, Thresholds } from './types.js'
import type { StructuralFilters } from './structural.js'
import type { EstimateType } from './detail.js'

/** A relation row exists only when a result strictly passes both site thresholds. */
export function contrastRelation(data: AppData, thresholds: Thresholds): UpSetModel {
  const definitions=data.run.contrasts.map(id=>({id,label:id,enabled:true}))
  function* pairs(): Iterable<MembershipPair> {
    for (const row of data.siteIndex) if (isSignificant(row,thresholds)) {
      yield [siteIdentity(row.protein_Id,row.site),row.contrast]
    }
  }
  return computeUpSet(definitions,pairs())
}

/** Eligibility applies to sets; leading edge applies only to membership rows. */
export function sequenceRelation(payload: GseaPayload, fdr: number, leading: boolean): UpSetModel {
  const definitions=sequenceSetsAtFdr(payload,fdr).map(row=>({
    id:sequenceSetKey(row.source,row.sequence_set),label:`${row.sequence_set} · ${row.source}`,enabled:true,
  }))
  const eligible=new Set(definitions.map(set=>set.id))
  function* pairs(): Iterable<MembershipPair> {
    for (const row of payload.memberships) {
      const id=sequenceSetKey(row.source,row.sequence_set)
      if (eligible.has(id) && (!leading || row.is_leading_edge)) {
        yield [siteIdentity(row.protein_Id,row.site),id]
      }
    }
  }
  return computeUpSet(definitions,pairs())
}

function propertyRelation(data: AppData, contrast: string, estimate: EstimateType,
  structural: StructuralFilters): {definitions:SetDefinition[]; pairs:MembershipPair[]} {
  const definitions: SetDefinition[]=[
    {id:'estimate',label:`estimate_${estimate}`,enabled:estimate!=='all'},
    ...(['exposure','region'] as const).map(id=>({id,label:`${id}_${structural[id]}`,enabled:structural[id]!=='all'})),
  ]
  const pairs: MembershipPair[]=[]
  if (estimate!=='all') for (const row of data.siteIndex) {
    if (row.contrast===contrast && row.site_estimate_type===estimate) {
      pairs.push([siteIdentity(row.protein_Id,row.site),'estimate'])
    }
  }
  for (const row of data.sites) for (const id of ['exposure','region'] as const) {
    if (structural[id]!=='all' && row.structure[id]===structural[id]) {
      pairs.push([siteIdentity(row.protein_Id,row.site),id])
    }
  }
  return {definitions,pairs}
}

export type FilterBranch = 'a' | 'b' | 'c'
export interface FilterState { a:SetSelection; b:SetSelection; c:SetSelection; globalOff:boolean }
/** A chooses which contrasts B may inspect, not which sites enter B. */
export function contrastsAllowedByA(contrasts: readonly string[], choice: SetSelection): string[] {
  if (choice.kind==='off'||choice.kind==='all') return [...contrasts]
  const selected=new Set(choice.kind==='set'?[choice.id]:choice.kind==='intersection'?choice.ids:[])
  return contrasts.filter(contrast=>selected.has(contrast))
}
/** Preserve the current upper context while A permits it; otherwise choose its first contrast. */
export function chooseDisplayedContrast(allowed: readonly string[], current: string): string {
  return allowed.includes(current)?current:allowed[0]??''
}
export interface EnrichmentInput {
  payload: GseaPayload | null
  fdr: number
  leading: boolean
  context: string
  revision: number
  status: string
  ready: boolean
}

export const NO_ENRICHMENT: EnrichmentInput = {payload:null,fdr:0.05,leading:false,
  context:'',revision:0,status:'',ready:true}

/** DOM-free owner of A/B/C relations, transitions and the measured-site universe. */
export class FilterModel {
  private readonly selectionState: FilterState = {a:{kind:'all'},b:{kind:'off'},c:{kind:'all'},globalOff:false}
  private models: Record<FilterBranch, UpSetModel> = {
    a:computeUpSet([],[]),b:computeUpSet([],[]),c:computeUpSet([],[]),
  }
  private measured = new Set<string>()
  private propertyDefinitions: SetDefinition[] = []
  private propertyPairs: MembershipPair[] = []
  private key = ''
  private cInputKey = ''
  private context = ''
  includeB = false
  enrichmentReady = true
  enrichmentStatus = ''
  revision = 0
  filteredSiteKeys: ReadonlySet<string> = new Set()
  siteKeys: ReadonlySet<string> = new Set()

  get state(): Readonly<FilterState> { return this.selectionState }
  get(branch: FilterBranch): UpSetModel { return this.models[branch] }
  get properties(): readonly SiteSet[] { return this.models.c.sets.filter(set=>
    ['estimate','exposure','region'].includes(set.id)) }
  get universeSize(): number { return this.measured.size }
  get bContrasts(): readonly string[] {
    return contrastsAllowedByA(this.models.a.sets.map(set=>set.id),this.selectionState.a)
  }

  update(data:AppData, contrast:string, thresholds:Thresholds, estimate:EstimateType,
    structural:StructuralFilters, enrichment:EnrichmentInput): {changed:boolean; notice:string} {
    const key=JSON.stringify([contrast,thresholds,estimate,structural,enrichment.revision])
    if (key===this.key) return {changed:false,notice:''}
    const cInputKey=JSON.stringify([thresholds,estimate,structural,estimate==='all'?'':contrast,
      this.selectionState.b.kind==='off'?null:enrichment.revision])
    const previous=this.models.b
    this.includeB=Boolean(data.run.gsea?.results.length)
    this.measured=new Set(data.sites.map(s=>siteIdentity(s.protein_Id,s.site)))
    this.models.a=contrastRelation(data,thresholds)
    this.models.b=enrichment.payload
      ? sequenceRelation(enrichment.payload,enrichment.fdr,enrichment.leading) : computeUpSet([],[])
    const properties=propertyRelation(data,contrast,estimate,structural)
    this.propertyDefinitions=properties.definitions
    this.propertyPairs=properties.pairs
    this.enrichmentReady=enrichment.ready
    this.enrichmentStatus=enrichment.status
    const notices:string[]=[]
    const contextChanged=enrichment.context!==this.context
    if (enrichment.ready || contextChanged) {
      const eligibleChanged=JSON.stringify(previous.sets.map(s=>s.id).sort())
        !==JSON.stringify(this.models.b.sets.map(s=>s.id).sort())
      const b=this.selectionState.b
      if (b.kind!=='off' && (contextChanged
        || (b.kind==='set' && !this.models.b.sets.some(s=>s.id===b.id))
        || (b.kind==='intersection' && eligibleChanged))) {
        this.selectionState.b={kind:'all'}
        notices.push('Sequence_set selection reset to all after an enrichment context or eligibility change.')
      }
    }
    this.context=enrichment.context
    if (this.cInputKey && cInputKey!==this.cInputKey &&
      ['set','intersection'].includes(this.selectionState.c.kind)) {
      this.selectionState.c={kind:'all'}
      notices.push('Upstream filters changed. C returned to all (union); A and B retain their selections.')
    }
    this.key=key
    this.cInputKey=cInputKey
    this.recompute()
    return {changed:true,notice:notices.join(' ')}
  }

  /** Whole set, exact signature and reclick transitions are identical in A, B and C. */
  select(branch: FilterBranch, selection: SetSelection): boolean {
    if (branch==='b'&&(!this.includeB||!this.enrichmentReady)&&selection.kind!=='off') return false
    const choice=selection.kind==='intersection'
      ? {kind:'intersection' as const,ids:[...selection.ids].sort()} : selection
    this.selectionState[branch]=JSON.stringify(this.selectionState[branch])===JSON.stringify(choice)
      && !['all','off'].includes(choice.kind) ? {kind:'all'} : choice
    if (branch!=='c'&&['set','intersection'].includes(this.selectionState.c.kind)) {
      this.selectionState.c={kind:'all'}
    }
    this.recompute()
    return true
  }

  setGlobalOff(off: boolean): boolean {
    if (this.selectionState.globalOff===off) return false
    this.selectionState.globalOff=off
    this.recompute()
    return true
  }

  private recompute(): void {
    const definitions: SetDefinition[]=[]
    const pairs: MembershipPair[]=[]
    for (const [branch,id] of [['a','contrast_selection'],['b','sequence_set_selection']] as const) {
      if (branch==='b'&&!this.includeB) continue
      const selection=this.selectionState[branch]
      definitions.push({id,label:`${id}_${selectionLabel(this.models[branch],selection)}`,
        enabled:selection.kind!=='off'})
      for (const siteKey of resolveSelection(this.models[branch],selection)??[]) pairs.push([siteKey,id])
    }
    this.models.c=computeUpSet([...definitions,...this.propertyDefinitions],
      [...pairs,...this.propertyPairs])
    const c=this.models.c
    if (this.selectionState.c.kind==='off') {
      this.filteredSiteKeys=definitions.some(set=>set.enabled)
        ? new Set(pairs.map(([siteKey])=>siteKey)) : this.measured
    } else if (!c.sets.some(set=>set.enabled)) this.filteredSiteKeys=this.measured
    else if (this.selectionState.b.kind!=='off' && !this.enrichmentReady) this.filteredSiteKeys=new Set()
    else this.filteredSiteKeys=resolveSelection(c,this.selectionState.c)!
    this.siteKeys=this.selectionState.globalOff?this.measured:this.filteredSiteKeys
    this.revision++
  }
}
