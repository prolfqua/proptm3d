import { UNAVAILABLE_STRUCTURE } from '../src/structural.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildAbundanceFigure,
  buildNtoCFigure,
  buildProteinSiteFigure,
  buildVolcanoFigure,
  focusProteinTraces,
  plotThresholds,
  proteinBackgroundPoints,
  validThresholds,
} from '../src/charts';
import type { EvidencePayload, FeaturePayload, ProteinPayload, SiteIndexRow } from '../src/types';

function result(overrides: Partial<SiteIndexRow> = {}): SiteIndexRow {
  return {
    protein_Id: 'P12345', site: 'P12345_S10', contrast: 'A_vs_B',
    posInProtein: 10, modAA: 'S', sequence_window: 'AAAAAAASAAAAAAA',
    gene_name: 'Test', protein_length: 100, effect: 2, fdr: 0.01,
    p_value: 0.001, std_error: 0.2, site_estimate_type: 'observed',
    protein_estimate_type: 'observed', imputed: false,
    original_site_fc: 1.5, protein_fc: 0.5,
    accession: 'P12345', has_measurement: true, structure: UNAVAILABLE_STRUCTURE,
    ...overrides,
  };
}

function markerPoints(figure: { data: Record<string, unknown>[] }): Record<string, unknown>[] {
  return figure.data.filter((trace) => trace.mode === 'markers');
}

const volcanoBackground = { file: 'data/plot_backgrounds/volcano-0.png', x_range: [-4, 4] as [number, number],
  y_range: [0, 8] as [number, number] };
const proteinSiteBackground = { file: 'data/plot_backgrounds/protein-site-0.png',
  x_range: [-3, 3] as [number, number], y_range: [-5, 5] as [number, number] };

test('thresholds independently cap FDR and floor |log2FC|', () => {
  assert.equal(validThresholds(0.25, 1), true);
  assert.equal(validThresholds(0.2501, 1), false);
  assert.equal(validThresholds(0.25, 0.99), false);
  assert.equal(validThresholds(0, 1), false);
});

test('dot plots colour at most FDR < 0.25 and |log2FC| > 1 sites', () => {
  assert.deepEqual(plotThresholds({ fdr: 1, absEffect: 0 }), { fdr: 0.25, absEffect: 1 });
  assert.deepEqual(plotThresholds({ fdr: 0.05, absEffect: 2 }), { fdr: 0.05, absEffect: 2 });
});

test('volcano uses the static black background and exposes only passing points by default', () => {
  const rows = [
    result(),
    result({ site: 'P12345_T20', effect: -1, fdr: 0.05 }),
    result({ site: 'P12345_Y30', effect: null, fdr: null }),
    result({ site: 'P12345_S40', contrast: 'C_vs_D' }),
  ];
  const figure = buildVolcanoFigure(rows, 'A_vs_B', 0.05, 1, volcanoBackground);
  const traces = figure.data;
  assert.ok(traces.every((trace) => trace.type === 'scattergl'));
  assert.equal(traces.reduce((count, trace) => count + (trace.x as unknown[]).length, 0), 1);
  assert.deepEqual(traces[2].x, []);
  assert.equal((traces[2].marker as { color: string }).color, '#000000');
  const passing = traces.find((trace) => String(trace.name).startsWith('Passing, up'));
  assert.deepEqual(passing?.customdata, [['P12345', 'P12345_S10', 'A_vs_B', 'Test', 2, 0.01]]);
  assert.equal((passing?.marker as { color: string }).color, '#d62728');
  assert.equal((traces[1].marker as { color: string }).color, '#1f77b4');
  assert.deepEqual(figure.layout.images, [{
    source: volcanoBackground.file, xref: 'x', yref: 'y', x: -4, y: 8,
    sizex: 8, sizey: 8, xanchor: 'left', yanchor: 'top', sizing: 'stretch', layer: 'below',
  }]);
  assert.deepEqual((figure.layout.xaxis as { range: number[] }).range, [-4, 4]);
  assert.deepEqual((figure.layout.yaxis as { range: number[] }).range, [0, 8]);
  assert.match(JSON.stringify(figure.layout.annotations), /1 sites lack an effect or FDR/);
  assert.deepEqual((figure.layout.xaxis as { title: { text: string } }).title,
    { text: 'Method log2 fold change' });
  assert.throws(() => buildVolcanoFigure(rows, 'A_vs_B', 0.26, 1, volcanoBackground), RangeError);
});

test('protein-site scatter uses original site and total protein effects and reports missing pairs', () => {
  const rows = [
    result({ effect: 8, original_site_fc: -1.5, protein_fc: 0.25 }),
    result({ site: 'P12345_T20', original_site_fc: 0.5, protein_fc: null }),
  ];
  const { figure, missingCount } = buildProteinSiteFigure(rows, 'A_vs_B', 0.05, 1,
    proteinSiteBackground);
  assert.equal(missingCount, 1);
  assert.equal(figure.data.length, 3);
  assert.deepEqual(figure.data[0].x, [0.25]);
  assert.deepEqual(figure.data[0].y, [-1.5]);
  assert.deepEqual((figure.data[0].customdata as unknown[][])[0].slice(0, 3),
    ['P12345', 'P12345_S10', 'A_vs_B']);
  assert.deepEqual((figure.data[1].x as number[]), []);
  assert.deepEqual((figure.data[2].x as number[]), []);
  assert.deepEqual(figure.layout.images, [{
    source: proteinSiteBackground.file, xref: 'x', yref: 'y', x: -3, y: 5,
    sizex: 6, sizey: 10, xanchor: 'left', yanchor: 'top', sizing: 'stretch', layer: 'below',
  }]);
  assert.throws(() => buildProteinSiteFigure(rows, 'A_vs_B', 0.05, 0.5, proteinSiteBackground), RangeError);
});

test('protein focus isolates colored points in both plots without changing their base figures', () => {
  const rows = [
    result({ site: 'P12345_S10', effect: 2, fdr: 0.01 }),
    result({ protein_Id: 'P67890', accession: 'P67890', site: 'P67890_S10', effect: 3, fdr: 0.02 }),
    result({ site: 'P12345_T20', effect: -2.5, fdr: 0.01 }),
    result({ protein_Id: 'P67890', accession: 'P67890', site: 'P67890_T20', effect: -3, fdr: 0.01 }),
  ];
  const figures = [
    buildVolcanoFigure(rows, 'A_vs_B', 0.05, 1, volcanoBackground),
    buildProteinSiteFigure(rows, 'A_vs_B', 0.05, 1, proteinSiteBackground).figure,
  ];

  for (const figure of figures) {
    const original = structuredClone(figure.data);
    const focus = focusProteinTraces(figure, 'P12345');
    assert.deepEqual(focus.customdata.map((trace) => trace.map((point) => (point as unknown[])[0])),
      [['P12345'], ['P12345'], []]);
    assert.deepEqual(focus.x.map((trace) => trace.length), [1, 1, 0]);
    assert.deepEqual(focus.y.map((trace) => trace.length), [1, 1, 0]);
    const absent = focusProteinTraces(figure, 'NO_SUCH_PROTEIN');
    assert.deepEqual(absent, { x: [[], [], []], y: [[], [], []], customdata: [[], [], []] });
    const restored = focusProteinTraces(figure, null);
    assert.deepEqual(restored.x, original.map((trace) => trace.x));
    assert.deepEqual(restored.y, original.map((trace) => trace.y));
    assert.deepEqual(restored.customdata, original.map((trace) => trace.customdata));
    assert.deepEqual(figure.data, original);
  }
});

test('protein hover black points contain only non-passing plottable sites of the selected protein', () => {
  const rows = [
    result({ site: 'P12345_S10', effect: 2, fdr: 0.01 }),
    result({ site: 'P12345_T20', effect: 0.5, fdr: 0.02, protein_fc: 0.4, original_site_fc: 0.5 }),
    result({ site: 'P12345_Y30', effect: -2, fdr: 0.1, protein_fc: 0.4, original_site_fc: -1.5 }),
    result({ site: 'P12345_S40', effect: null, fdr: null, protein_fc: 0.4, original_site_fc: 0.8 }),
    result({ site: 'P12345_T50', effect: 0.6, fdr: null, protein_fc: null, original_site_fc: 0.8 }),
    result({ protein_Id: 'P67890', accession: 'P67890', site: 'P67890_S10', effect: 0.5, fdr: 0.02 }),
    result({ site: 'P12345_S60', contrast: 'C_vs_D', effect: 0.5, fdr: 0.02 }),
  ];
  const volcano = proteinBackgroundPoints(rows, 'P12345', 'A_vs_B', 'volcano', 0.05, 1);
  assert.deepEqual(volcano.x, [0.5, -2]);
  assert.deepEqual(volcano.y, [-Math.log10(0.02), 1]);
  assert.deepEqual(volcano.customdata.map((point) => point[1]), ['P12345_T20', 'P12345_Y30']);

  const scatter = proteinBackgroundPoints(rows, 'P12345', 'A_vs_B', 'protein-site', 0.05, 1);
  assert.deepEqual(scatter.x, [0.4, 0.4, 0.4]);
  assert.deepEqual(scatter.y, [0.5, -1.5, 0.8]);
  assert.deepEqual(scatter.customdata.map((point) => point[1]),
    ['P12345_T20', 'P12345_Y30', 'P12345_S40']);
  assert.deepEqual(proteinBackgroundPoints(rows, 'ABSENT', 'A_vs_B', 'volcano', 0.05, 1),
    { x: [], y: [], customdata: [] });
  assert.throws(() => proteinBackgroundPoints(rows, 'P12345', 'A_vs_B', 'volcano', 0.3, 1), RangeError);
});

test('N-to-C keeps measured sites without results on the baseline and hides nonexact features', () => {
  const protein: ProteinPayload = {
    protein: {
      protein_Id: 'P12345', accession: 'P12345', gene_name: 'Test', protein_length: 100,
      description: 'Test protein OS=Mus musculus OX=10090',
      uniprot_url: 'https://www.uniprot.org/uniprotkb/P12345',
      string_url: 'https://string-db.org/cgi/network?identifiers=P12345&species=10090',
      detected_sites: 3, measured_sites: 3, taxon_id: 10090,
      sequence_length: 100, annotation_status: 'matched',
    },
    sites: [
      { protein_Id: 'P12345', site: 'P12345_S10', 'fasta.id': 'sp|P12345|TEST_MOUSE',
        gene_name: 'Test', protein_length: 100, posInProtein: 10, modAA: 'S',
        SequenceWindow: null, accession: 'P12345', has_measurement: true },
      { protein_Id: 'P12345', site: 'P12345_T20', 'fasta.id': 'sp|P12345|TEST_MOUSE',
        gene_name: 'Test', protein_length: 100, posInProtein: 20, modAA: 'T',
        SequenceWindow: null, accession: 'P12345', has_measurement: true },
      { protein_Id: 'P12345', site: 'P12345_Y30', 'fasta.id': 'sp|P12345|TEST_MOUSE',
        gene_name: 'Test', protein_length: 100, posInProtein: 30, modAA: 'Y',
        SequenceWindow: null, accession: 'P12345', has_measurement: true },
    ],
    results: [
      result(),
      result({ site: 'P12345_T20', posInProtein: 20, modAA: 'T', effect: null,
        fdr: null, site_estimate_type: 'lod_imputed', imputed: true }),
    ],
    structures: [],
    context: [],
  };
  const features: FeaturePayload = {
    status: 'matched',
    features: [
      { accession: 'P12345', protein_Id: 'P12345', type: 'Domain', description: 'Kinase',
        start: 5, end: 50, start_modifier: 'EXACT', end_modifier: 'EXACT', evidence: null },
      { accession: 'P12345', protein_Id: 'P12345', type: 'Chain', description: 'Full chain',
        start: 1, end: 100, start_modifier: 'EXACT', end_modifier: 'EXACT', evidence: null },
      { accession: 'P12345', protein_Id: 'P12345', type: 'Region', description: 'Uncertain',
        start: 70, end: 80, start_modifier: 'GREATER_THAN', end_modifier: 'EXACT', evidence: null },
      { accession: 'P12345', protein_Id: 'P12345', type: 'Motif', description: 'YXXM motif 1',
        start: 70, end: 74, start_modifier: 'EXACT', end_modifier: 'EXACT',
        evidence: '[{"evidenceCode":"ECO:0000250","source":"SAM","id":"MobiDB-lite"}]' },
      { accession: 'P12345', protein_Id: 'P12345', type: 'Motif', description: 'YXXM motif 2',
        start: 73, end: 77, start_modifier: 'EXACT', end_modifier: 'EXACT',
        evidence: JSON.stringify([
          { evidenceCode: 'ECO:0000250', source: 'SAM', id: '<source>' },
          { evidenceCode: 'ECO:0000269', source: 'PubMed', id: '12345' },
          { evidenceCode: 'ECO:0000305' },
        ]) },
    ],
  };
  const allSiteIds = new Set(protein.sites.map((site) => site.site));
  const figure = buildNtoCFigure(protein, features, 'DPA', 'A_vs_B', 'P12345_Y30', 0.05, 0, allSiteIds);
  const points = markerPoints(figure);
  assert.equal(points.reduce((count, trace) => count + (trace.x as unknown[]).length, 0), 3);
  assert.ok(points.some((trace) => (trace.x as number[]).includes(30)
    && (trace.y as number[]).includes(0)));
  assert.ok(points.some((trace) => (trace.x as number[]).includes(20)
    && (trace.marker as { symbol: string[] }).symbol.includes('x')));
  const featureTracks = figure.data.filter((trace) => trace.yaxis === 'y2');
  assert.equal(featureTracks.length, 3);
  assert.ok(featureTracks.every((trace) => trace.mode === 'lines+markers' && !('text' in trace)));
  assert.ok(featureTracks.every((trace) =>
    JSON.stringify((trace.marker as { size: number[] }).size) === '[0,9,0]'));
  assert.ok((featureTracks[1].hovertemplate as string).includes('YXXM motif 1'));
  assert.ok((featureTracks[1].hovertemplate as string).includes('70–74'));
  assert.ok((featureTracks[1].hovertemplate as string).includes('ECO:0000250 (SAM: MobiDB-lite)'));
  assert.ok(!(featureTracks[1].hovertemplate as string).includes('&quot;'));
  assert.ok(!(featureTracks[1].hovertemplate as string).includes('evidenceCode'));
  assert.ok((featureTracks[2].hovertemplate as string).includes('SAM: &lt;source&gt;'));
  assert.ok((featureTracks[2].hovertemplate as string).includes('+1 more evidence records'));
  assert.ok(!(featureTracks[2].hovertemplate as string).includes('ECO:0000305'));
  assert.ok((figure.layout.shapes as Array<{ type: string }>).some((shape) => shape.type === 'rect'));
  assert.deepEqual((figure.layout.xaxis as { title: { text: string } }).title,
    { text: 'Protein position (residue)' });
  const dpu = buildNtoCFigure(protein, features, 'DPU', 'A_vs_B', null, 0.05, 0, allSiteIds);
  assert.ok(!(dpu.layout.shapes as Array<{ type: string }>).some((shape) => shape.type === 'rect'));

  const uncertain: ProteinPayload = {
    ...protein,
    sites: protein.sites.map((site) => site.site === 'P12345_Y30'
      ? { ...site, modAA: 'NotLoc', startModSite: 32, endModSite: 38 } : site),
  };
  const mismatch = buildNtoCFigure(uncertain, { ...features, status: 'sequence_mismatch' },
    'DPU', 'A_vs_B', null, 0.05, 0, allSiteIds);
  assert.equal(mismatch.data.filter((trace) => trace.yaxis === 'y2').length, 0);
  assert.ok(markerPoints(mismatch).some((trace) => (trace.x as number[]).includes(35)));

  const passingOnly = buildNtoCFigure(protein, features, 'DPA', 'A_vs_B', 'P12345_Y30',
    0.05, 0, new Set(['P12345_S10']));
  assert.deepEqual(markerPoints(passingOnly).flatMap((trace) => trace.x as number[]), [10]);
  assert.deepEqual(markerPoints(passingOnly).flatMap((trace) => trace.customdata as unknown[][]),
    [['P12345', 'P12345_S10', 'A_vs_B']]);
  assert.ok(!markerPoints(passingOnly).some((trace) =>
    (trace.marker as { symbol: string[] }).symbol.includes('x')));
  assert.equal(markerPoints(buildNtoCFigure(protein, features, 'DPA', 'A_vs_B', null,
    0.05, 0, new Set())).length, 0);

  const contextFigure = buildNtoCFigure(protein, features, 'DPA', 'A_vs_B', null,
    0.05, 0, allSiteIds, [
      { fragment: 2, position: 10, plddt: 97, is_exposed: false, is_idr: false },
      { fragment: 1, position: 10, plddt: 64.2, is_exposed: true, is_idr: true },
      { fragment: 1, position: 11, plddt: null, is_exposed: null, is_idr: null },
      { fragment: 1, position: 12, plddt: 93.1, is_exposed: false, is_idr: false },
    ]);
  const tracks = contextFigure.data.filter((trace) => trace.yaxis === 'y3');
  assert.deepEqual(tracks.map((trace) => trace.name), ['Exposure', 'Region', 'pLDDT']);
  assert.ok(tracks.every((trace) => trace.type === 'heatmap' && trace.hoverongaps === false));
  assert.deepEqual(tracks.map((trace) => (trace.z as Array<Array<number | null>>)[0][9]), [0, 1, 64.2]);
  assert.deepEqual(tracks.map((trace) => (trace.z as Array<Array<number | null>>)[0][10]),
    [null, null, null]);
  assert.deepEqual(tracks.map((trace) => (trace.z as Array<Array<number | null>>)[0][11]), [1, 0, 93.1]);
  assert.match((tracks[0].text as Array<Array<string | null>>)[0][9]!, /Exposed · AlphaFold fragment 1/);
  assert.match((tracks[2].text as Array<Array<string | null>>)[0][9]!, /pLDDT 64.2/);
  assert.deepEqual((contextFigure.layout.yaxis3 as { ticktext: string[] }).ticktext,
    ['pLDDT', 'Region', 'Exposure']);
  assert.ok((contextFigure.layout.height as number) > (figure.layout.height as number));
});

test('abundance uses aligned samples in method panels and leaves absent values null', () => {
  const evidence: EvidencePayload = {
    samples: [
      { sample: 'control_1', condition: 'Control' },
      { sample: 'treatment_1', condition: 'Treatment' },
    ],
    measurements: [
      { protein_Id: 'P12345', site: 'P12345_S10', sample: 'control_1', condition: 'Control',
        site_abundance: null, protein_abundance: 10, corrected_abundance: null },
      { protein_Id: 'P12345', site: 'P12345_S10', sample: 'treatment_1', condition: 'Treatment',
        site_abundance: 12, protein_abundance: 11, corrected_abundance: 1 },
    ],
  };
  const cf = buildAbundanceFigure(evidence, 'CF-DPU', 'P12345_S10', 'A_vs_B');
  assert.equal(cf.data.length, 6);
  assert.deepEqual(cf.data[0].y, [null]);
  assert.deepEqual(cf.data[1].y, [12]);
  assert.deepEqual(cf.data[5].y, [1]);
  assert.deepEqual((cf.layout.yaxis3 as { title: { text: string } }).title,
    { text: 'Log2 difference' });
  const dpa = buildAbundanceFigure(evidence, 'DPA', 'P12345_S10', 'A_vs_B');
  assert.equal(dpa.data.length, 4);
  assert.deepEqual(dpa.data[2].y, [10]);
  assert.deepEqual(dpa.data[3].y, [11]);
  assert.deepEqual((dpa.layout.yaxis2 as { title: { text: string } }).title,
    { text: 'Normalized log2 abundance' });
  assert.equal(buildAbundanceFigure(evidence, 'DPU', 'P12345_S10', 'A_vs_B').data.length, 4);
});
