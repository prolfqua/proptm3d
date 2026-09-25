import type { ProteinFeature, ResidueContext } from './types.js';

export type StructureColoring = 'plddt' | 'position' | 'neutral' | 'exposure' | 'region' | 'uniprot';

export const UNANNOTATED_COLOR = 0xa9b6c3;
export const EXPOSURE_COLORS = { exposed: 0x008f83, buried: 0xcd8d2b } as const;
export const REGION_COLORS = { idr: 0x8b5da6, structured: 0x3972af } as const;
export const FEATURE_COLORS: Record<string, number> = {
  Motif: 0xd28b3b,
  Signal: 0x59a276,
  Transmembrane: 0xc56551,
  Repeat: 0x4c9699,
  Region: 0x8866a6,
  Domain: 0x526da7,
};

export function residueColor(
  coloring: 'exposure' | 'region', context: ResidueContext | undefined,
): number {
  if (coloring === 'exposure') {
    return context?.is_exposed === true ? EXPOSURE_COLORS.exposed
      : context?.is_exposed === false ? EXPOSURE_COLORS.buried : UNANNOTATED_COLOR;
  }
  return context?.is_idr === true ? REGION_COLORS.idr
    : context?.is_idr === false ? REGION_COLORS.structured : UNANNOTATED_COLOR;
}

/** More specific UniProt features take precedence where intervals overlap. */
export function featureColor(position: number, features: ProteinFeature[]): number {
  for (const type of Object.keys(FEATURE_COLORS)) {
    if (features.some((feature) => feature.type === type
      && feature.start_modifier === 'EXACT' && feature.end_modifier === 'EXACT'
      && feature.start !== null && feature.end !== null
      && feature.start <= position && position <= feature.end)) {
      return FEATURE_COLORS[type];
    }
  }
  return UNANNOTATED_COLOR;
}
