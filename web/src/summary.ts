import type {
  ProteinCatalogRow,
  SiteIndexRow,
  SiteResult,
  Thresholds,
} from "./types.js";

export interface ProteinSummary extends ProteinCatalogRow {
  tested_sites: number;
  significant_sites: number;
  up_pairs: number;
  down_pairs: number;
  largest_effect: number | null;
}

interface SummaryState {
  summary: ProteinSummary;
  tested: Set<string>;
  significant: Set<string>;
  up: Set<string>;
  down: Set<string>;
}

export function isFiniteNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export function isTested(row: Pick<SiteResult, "effect" | "fdr">): boolean {
  return isFiniteNumber(row.effect) && isFiniteNumber(row.fdr);
}

/** Cutoffs the tables and protein views accept; the dot plots are limited by plotThresholds. */
export function validCutoffs(thresholds: Thresholds): boolean {
  return Number.isFinite(thresholds.fdr) && thresholds.fdr > 0 && thresholds.fdr <= 1
    && Number.isFinite(thresholds.absEffect) && thresholds.absEffect >= 0;
}

export function isSignificant(
  row: Pick<SiteResult, "effect" | "fdr">,
  thresholds: Thresholds,
): boolean {
  return isTested(row)
    && row.fdr! < thresholds.fdr
    && Math.abs(row.effect!) > thresholds.absEffect;
}

// A null contrast means all contrasts. Measured counts come from the protein
// catalog because CF-DPU's global site index excludes sites without results.
export function summarizeProteins(
  proteins: ProteinCatalogRow[],
  siteIndex: SiteIndexRow[],
  contrast: string | null,
  thresholds: Thresholds,
): ProteinSummary[] {
  const states = new Map<string, SummaryState>();
  for (const protein of proteins) {
    states.set(protein.protein_Id, {
      summary: {
        ...protein,
        tested_sites: 0,
        significant_sites: 0,
        up_pairs: 0,
        down_pairs: 0,
        largest_effect: null,
      },
      tested: new Set(),
      significant: new Set(),
      up: new Set(),
      down: new Set(),
    });
  }

  for (const row of siteIndex) {
    if (contrast !== null && row.contrast !== contrast) continue;
    const state = states.get(row.protein_Id);
    if (!state) continue;
    if (isFiniteNumber(row.effect)
        && (state.summary.largest_effect === null
          || Math.abs(row.effect) > Math.abs(state.summary.largest_effect))) {
      state.summary.largest_effect = row.effect;
    }
    if (isTested(row)) state.tested.add(row.site);
    if (!isSignificant(row, thresholds)) continue;
    state.significant.add(row.site);
    const pair = `${row.site}\u0000${row.contrast}`;
    if (row.effect! > 0) state.up.add(pair);
    else state.down.add(pair);
  }

  return proteins.map((protein) => {
    const state = states.get(protein.protein_Id)!;
    state.summary.tested_sites = state.tested.size;
    state.summary.significant_sites = state.significant.size;
    state.summary.up_pairs = state.up.size;
    state.summary.down_pairs = state.down.size;
    return state.summary;
  });
}
