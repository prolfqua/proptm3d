import type { ExposureClass, RegionClass, SiteStructuralContext, SiteStructure } from './types.js'

export type ExposureFilter = 'all' | 'exposed' | 'buried'
export type RegionFilter = 'all' | 'idr' | 'structured'

export interface StructuralFilters {
  exposure: ExposureFilter
  region: RegionFilter
}

export const ALL_STRUCTURES: StructuralFilters = { exposure: 'all', region: 'all' }

export const UNAVAILABLE_STRUCTURE: SiteStructure = {
  exposure: 'unavailable', region: 'unavailable', plddt: null, context: null,
}

export function siteStructure(context: SiteStructuralContext): SiteStructure {
  if (context.mapping_status !== 'matched') {
    const status = context.mapping_status
    return { exposure: status, region: status, plddt: null, context }
  }
  return {
    exposure: context.is_exposed ? 'exposed' : 'buried',
    region: context.is_idr ? 'idr' : 'structured',
    plddt: context.plddt,
    context,
  }
}

export function isStructurallyFiltered(filters: StructuralFilters): boolean {
  return filters.exposure !== 'all' || filters.region !== 'all'
}

export function passesStructuralFilters(structure: SiteStructure, filters: StructuralFilters): boolean {
  return (filters.exposure === 'all' || structure.exposure === filters.exposure)
    && (filters.region === 'all' || structure.region === filters.region)
}

const EXPOSURE_LABELS: Record<ExposureClass, string> = {
  exposed: 'Exposed', buried: 'Buried',
  unavailable: 'Unavailable', residue_mismatch: 'Residue mismatch',
}
const REGION_LABELS: Record<RegionClass, string> = {
  idr: 'IDR', structured: 'Structured',
  unavailable: 'Unavailable', residue_mismatch: 'Residue mismatch',
}

export function exposureLabel(structure: SiteStructure): string {
  return EXPOSURE_LABELS[structure.exposure]
}

export function regionLabel(structure: SiteStructure): string {
  return REGION_LABELS[structure.region]
}

export function plddtLabel(structure: SiteStructure): string {
  return structure.plddt === null ? '—' : String(Math.round(structure.plddt))
}

/** e.g. `S123 · Exposed · IDR · pLDDT 64` or `S410 · Structural context unavailable`. */
export function structureLabel(siteLabel: string, structure: SiteStructure): string {
  if (structure.exposure === 'unavailable') return `${siteLabel} · Structural context unavailable`
  if (structure.exposure === 'residue_mismatch') return `${siteLabel} · AlphaFold residue mismatch`
  return `${siteLabel} · ${exposureLabel(structure)} · ${regionLabel(structure)} · pLDDT ${plddtLabel(structure)}`
}

/** Raw neighbor counts, for tooltips rather than primary columns. */
export function structureDetail(structure: SiteStructure): string {
  const row = structure.context
  if (!row || row.mapping_status === 'unavailable') return 'No AlphaFold model position for this site.'
  const model = `${row.model_id} residue ${row.model_position} ${row.residue}`
  if (row.mapping_status === 'residue_mismatch') return `${model}: residue does not match the PTM site`
  return `${model}: part-sphere neighbors ${row.nAA_12_70_pae} (exposed ≤ 5), `
    + `smoothed full-sphere neighbors ${row.nAA_24_180_pae_smooth10?.toFixed(1)} (IDR ≤ 34.27)`
}
