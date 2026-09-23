import { isSignificant } from './summary.js'
import type { MeasuredSite, ProteinDetail, SiteResult, Thresholds } from './types.js'

export interface DetailRow {
  row_id: string
  protein_Id: string
  site: string
  contrast: string
  posInProtein: number | null
  modAA: string | null
  sequence_window: string | null
  effect: number | null
  fdr: number | null
  p_value: number | null
  has_measurement: boolean
  estimate_status: string
  imputed: boolean
  passes_cutoff: boolean
}

export type EstimateType = 'all' | 'observed' | 'lod_imputed'

/** Keep the prepared source intact, but omit FASTA organism metadata from the visible name. */
export function displayProteinDescription(description: string | null): string | null {
  return description?.split(/\s+OS=/, 1)[0]?.trim() || null
}

function rowFrom(
  measured: MeasuredSite | undefined,
  result: SiteResult | undefined,
  contrast: string,
  thresholds: Thresholds,
): DetailRow {
  const site = measured?.site ?? result!.site
  return {
    row_id: `${site}\u0000${contrast}`,
    protein_Id: measured?.protein_Id ?? result!.protein_Id,
    site,
    contrast,
    posInProtein: measured?.posInProtein ?? result?.posInProtein ?? null,
    modAA: measured?.modAA ?? result?.modAA ?? null,
    sequence_window: measured?.SequenceWindow ?? result?.sequence_window ?? null,
    effect: result?.effect ?? null,
    fdr: result?.fdr ?? null,
    p_value: result?.p_value ?? null,
    has_measurement: measured?.has_measurement ?? false,
    estimate_status: !result ? 'No result' : result.site_estimate_type ?? (result.imputed ? 'Imputed' : 'Estimated'),
    imputed: result?.imputed ?? false,
    passes_cutoff: result ? isSignificant(result, thresholds) : false,
  }
}

/** Keep measured sites without a result, including CF-DPU's untested sites. */
export function buildDetailRows(detail: ProteinDetail, contrast: string, thresholds: Thresholds): DetailRow[] {
  const measured = new Map(detail.sites.map((site) => [site.site, site]))
  const selectedResults = detail.results.filter((result) => result.contrast === contrast)
  const results = new Map(selectedResults.map((result) => [result.site, result]))
  const rows = detail.sites.map((site) => rowFrom(site, results.get(site.site), contrast, thresholds))
  for (const result of selectedResults) {
    if (measured.has(result.site)) continue
    rows.push(rowFrom(undefined, result, contrast, thresholds))
  }
  return rows
}

/** Select the sites shared by the detail table, structure, N-to-C plot, and abundance picker. */
export function selectDetailRows(
  detail: ProteinDetail,
  contrast: string,
  thresholds: Thresholds,
  estimateType: EstimateType,
  showAll: boolean,
): DetailRow[] {
  return buildDetailRows(detail, contrast, thresholds).filter((row) =>
    (showAll || row.passes_cutoff) && (estimateType === 'all' || row.estimate_status === estimateType),
  )
}
