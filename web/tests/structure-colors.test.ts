import assert from 'node:assert/strict';
import test from 'node:test';
import { EXPOSURE_COLORS, FEATURE_COLORS, REGION_COLORS, UNANNOTATED_COLOR,
  featureColor, residueColor } from '../src/structure-colors.js';
import type { ProteinFeature, ResidueContext } from '../src/types.js';

const residue = (is_exposed: boolean | null, is_idr: boolean | null): ResidueContext =>
  ({ fragment: 1, position: 10, is_exposed, is_idr });

test('exposure and region colors distinguish both classes from missing context', () => {
  assert.equal(residueColor('exposure', residue(true, false)), EXPOSURE_COLORS.exposed);
  assert.equal(residueColor('exposure', residue(false, true)), EXPOSURE_COLORS.buried);
  assert.equal(residueColor('region', residue(false, true)), REGION_COLORS.idr);
  assert.equal(residueColor('region', residue(true, false)), REGION_COLORS.structured);
  assert.equal(residueColor('region', residue(null, null)), UNANNOTATED_COLOR);
  assert.equal(residueColor('exposure', undefined), UNANNOTATED_COLOR);
});

test('UniProt coloring uses exact interval coordinates and specific feature priority', () => {
  const feature = (type: string, start: number, end: number,
    start_modifier = 'EXACT'): ProteinFeature => ({
    accession: 'P1', protein_Id: 'P1', type, description: null, start, end,
    start_modifier, end_modifier: 'EXACT', evidence: null,
  });
  const features = [feature('Domain', 1, 30), feature('Motif', 8, 12),
    feature('Region', 40, 50, 'LESS_THAN')];
  assert.equal(featureColor(10, features), FEATURE_COLORS.Motif);
  assert.equal(featureColor(20, features), FEATURE_COLORS.Domain);
  assert.equal(featureColor(45, features), UNANNOTATED_COLOR);
  assert.equal(featureColor(60, features), UNANNOTATED_COLOR);
});
