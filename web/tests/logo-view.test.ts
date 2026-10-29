import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AMINO_ACIDS } from '../src/logo';
import type { AminoAcid, LogoMatrix } from '../src/logo';
import { renderLogo } from '../src/logo-view';

function differenceMatrix(values: Partial<Record<AminoAcid, number>>): LogoMatrix {
  return Array.from({ length: 15 }, (_, index) => {
    const frequencies = Object.fromEntries(AMINO_ACIDS.map((aa) => [aa, 0])) as Record<AminoAcid, number>;
    return { position: index - 7, frequencies: index === 8 ? { ...frequencies, ...values } : frequencies };
  });
}

function render(matrix: LogoMatrix, signed: boolean): string {
  const host = { innerHTML: '' } as HTMLElement;
  renderLogo(host, matrix, signed, '');
  return host.innerHTML;
}

test('difference logo scales its axis to the tallest stack', () => {
  const svg = render(differenceMatrix({ P: 0.12, S: 0.06, E: -0.1, D: -0.05 }), true);
  assert.match(svg, />\+0\.2</);
  assert.match(svg, />−0\.2</);
  assert.match(svg, />P<\/text>/);
});

test('difference logo keeps a ±1 axis for differences up to one', () => {
  const svg = render(differenceMatrix({ P: 0.8, S: -0.7 }), true);
  assert.match(svg, />\+1</);
  assert.match(svg, />−1</);
});
