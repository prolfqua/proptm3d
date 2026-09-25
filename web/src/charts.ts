import type {
  EvidencePayload,
  FeaturePayload,
  MeasuredSite,
  ProteinPayload,
  ResidueContext,
  RunManifest,
  SiteIndexRow,
  SiteResult,
  Thresholds,
} from './types';
import { EXPOSURE_COLORS, PLDDT_COLORS, REGION_COLORS } from './structure-colors.js';

export interface FigureSpec {
  data: Record<string, unknown>[];
  layout: Record<string, unknown>;
}

export interface SitePoint {
  proteinId: string;
  site: string;
  contrast: string;
}

export interface ScatterFigure {
  figure: FigureSpec;
  missingCount: number;
}

export interface ProteinTraceUpdate {
  x: unknown[][];
  y: unknown[][];
  customdata: unknown[][];
}

export interface ProteinBackgroundPoints {
  x: number[];
  y: number[];
  customdata: unknown[][];
}

export interface PlotBackground {
  file: string;
  x_range: [number, number];
  y_range: [number, number];
}

type Method = RunManifest['method'];
type PlotRow = SiteIndexRow | SiteResult;

const COLORS = {
  ink: '#24354b',
  muted: '#68788b',
  grid: '#e4eaf0',
  up: '#b44e3d',
  down: '#356b9a',
  overlayUp: '#d62728',
  overlayDown: '#1f77b4',
  baseline: '#44546b',
  proteinBand: 'rgba(215, 183, 77, 0.25)',
  selected: '#152d46',
} as const;

const RESIDUE_COLORS: Record<string, string> = {
  S: '#0072B2',
  T: '#009E73',
  Y: '#D55E00',
  NotLoc: '#CC79A7',
};

const FEATURE_COLORS: Record<string, string> = {
  Domain: '#526da7',
  Region: '#8866a6',
  Motif: '#d28b3b',
  Repeat: '#4c9699',
  Transmembrane: '#c56551',
  Signal: '#59a276',
};

const FEATURE_TYPES = Object.keys(FEATURE_COLORS);

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function passes(row: PlotRow, fdrCutoff: number, fcCutoff: number): boolean {
  return finite(row.effect)
    && finite(row.fdr)
    && row.fdr < fdrCutoff
    && Math.abs(row.effect) > fcCutoff;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function baseLayout(title: string, height: number): Record<string, unknown> {
  return {
    title: { text: title, x: 0, xanchor: 'left', font: { size: 15, color: COLORS.ink } },
    height,
    margin: { l: 72, r: 28, t: 58, b: 62 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Inter, ui-sans-serif, system-ui, sans-serif', size: 12, color: COLORS.ink },
    hovermode: 'closest',
    legend: { orientation: 'h', y: 1.12, x: 1, xanchor: 'right', font: { size: 11 } },
    xaxis: { gridcolor: COLORS.grid, zerolinecolor: COLORS.baseline },
    yaxis: { gridcolor: COLORS.grid, zerolinecolor: COLORS.baseline },
  };
}

/** The volcano and protein/site scatter colour at most sites with FDR < 0.25 and |log2FC| > 1. */
export function plotThresholds(thresholds: Thresholds): Thresholds {
  return { fdr: Math.min(thresholds.fdr, 0.25), absEffect: Math.max(thresholds.absEffect, 1) };
}

export function validThresholds(fdrCutoff: number, fcCutoff: number): boolean {
  return Number.isFinite(fdrCutoff) && fdrCutoff > 0 && fdrCutoff <= 0.25
    && Number.isFinite(fcCutoff) && fcCutoff >= 1;
}

function backgroundLayout(background: PlotBackground): Record<string, unknown> {
  return {
    source: background.file,
    xref: 'x', yref: 'y',
    x: background.x_range[0], y: background.y_range[1],
    sizex: background.x_range[1] - background.x_range[0],
    sizey: background.y_range[1] - background.y_range[0],
    xanchor: 'left', yanchor: 'top', sizing: 'stretch', layer: 'below',
  };
}

function scatterTraces(
  rows: readonly SiteIndexRow[],
  x: (row: SiteIndexRow) => number | null,
  y: (row: SiteIndexRow) => number | null,
  fdrCutoff: number,
  fcCutoff: number,
  xLabel: string,
  yLabel: string,
): Record<string, unknown>[] {
  const categories: Array<{ key: 'up' | 'down'; name: string; color: string }> = [
    { key: 'up', name: 'Passing, up', color: COLORS.overlayUp },
    { key: 'down', name: 'Passing, down', color: COLORS.overlayDown },
  ];

  return categories.map(({ key, name, color }) => {
    const points = rows.filter((row) => finite(x(row)) && finite(y(row))
      && passes(row, fdrCutoff, fcCutoff)
      && ((row.effect as number) > 0 ? 'up' : 'down') === key);
    return {
      type: 'scattergl',
      mode: 'markers',
      name: `${name} (${points.length.toLocaleString()})`,
      showlegend: points.length > 0,
      x: points.map(x),
      y: points.map(y),
      customdata: points.map((row) => [
        row.protein_Id,
        row.site,
        row.contrast,
        row.gene_name ?? row.protein_Id,
        row.effect,
        row.fdr,
      ]),
      marker: {
        color,
        size: 8,
        opacity: 0.92,
        line: { color: '#ffffff', width: 0.8 },
      },
      hovertemplate: '<b>%{customdata[3]}</b> · %{customdata[0]}<br>'
        + `%{customdata[1]}<br>${xLabel}: %{x:.3f}<br>${yLabel}: %{y:.3f}<br>`
        + 'Method log2FC: %{customdata[4]:.3f}<br>'
        + 'FDR: %{customdata[5]:.3g}<extra></extra>',
    };
  });
}

function focusedBackgroundTrace(xLabel: string, yLabel: string): Record<string, unknown> {
  return {
    type: 'scattergl', mode: 'markers', name: 'Other sites', showlegend: false,
    x: [], y: [], customdata: [],
    marker: { color: '#000000', size: 5, opacity: 0.85 },
    hovertemplate: '<b>%{customdata[3]}</b> · %{customdata[0]}<br>'
      + `%{customdata[1]}<br>${xLabel}: %{x:.3f}<br>${yLabel}: %{y:.3f}<extra></extra>`,
  };
}

/** Non-passing sites for the selected protein, shown when the all-protein PNG is hidden. */
export function proteinBackgroundPoints(
  rows: readonly SiteIndexRow[],
  proteinId: string,
  contrast: string,
  chart: 'volcano' | 'protein-site',
  fdrCutoff: number,
  fcCutoff: number,
): ProteinBackgroundPoints {
  if (!validThresholds(fdrCutoff, fcCutoff)) throw new RangeError('FDR must be ≤ 0.25 and |log2FC| must be ≥ 1.');
  const points: ProteinBackgroundPoints = { x: [], y: [], customdata: [] };
  for (const row of rows) {
    if (row.protein_Id !== proteinId || row.contrast !== contrast || passes(row, fdrCutoff, fcCutoff)) continue;
    const x = chart === 'volcano' ? row.effect : row.protein_fc;
    const y = chart === 'volcano'
      ? finite(row.fdr) ? -Math.log10(Math.max(row.fdr, 1e-300)) : null
      : row.original_site_fc;
    if (!finite(x) || !finite(y)) continue;
    points.x.push(x);
    points.y.push(y);
    points.customdata.push([
      row.protein_Id, row.site, row.contrast, row.gene_name ?? row.protein_Id, row.effect, row.fdr,
    ]);
  }
  return points;
}

/** Dense black sites are precomputed; focused non-passing sites gain an interactive trace on hover. */
export function buildVolcanoFigure(
  rows: readonly SiteIndexRow[],
  contrast: string,
  fdrCutoff: number,
  fcCutoff: number,
  background: PlotBackground,
): FigureSpec {
  if (!validThresholds(fdrCutoff, fcCutoff)) throw new RangeError('FDR must be ≤ 0.25 and |log2FC| must be ≥ 1.');
  const scoped = rows.filter((row) => row.contrast === contrast);
  const plotted = scoped.filter((row) => finite(row.effect) && finite(row.fdr));
  const traces = scatterTraces(
    plotted,
    (row) => row.effect,
    (row) => finite(row.fdr) ? -Math.log10(Math.max(row.fdr, 1e-300)) : null,
    fdrCutoff,
    fcCutoff,
    'Method log2FC',
    '−log10(FDR)',
  );
  traces.push(focusedBackgroundTrace('Method log2FC', '−log10(FDR)'));
  const missing = scoped.length - plotted.length;
  const layout = baseLayout('Site effect and FDR', 390);
  layout.xaxis = { title: { text: 'Method log2 fold change' }, gridcolor: COLORS.grid,
    zerolinecolor: COLORS.baseline, range: background.x_range };
  layout.yaxis = { title: { text: '−log10(FDR)' }, gridcolor: COLORS.grid, range: background.y_range };
  layout.images = [backgroundLayout(background)];
  layout.shapes = [
    { type: 'line', x0: 0, x1: 0, y0: 0, y1: 1, yref: 'paper', line: { color: COLORS.baseline, width: 1 } },
    ...(fdrCutoff > 0 && fdrCutoff < 1 ? [{
      type: 'line', x0: 0, x1: 1, xref: 'paper', y0: -Math.log10(fdrCutoff), y1: -Math.log10(fdrCutoff),
      line: { color: COLORS.baseline, width: 1, dash: 'dot' },
    }] : []),
  ];
  if (missing > 0) {
    layout.annotations = [{
      x: 1, y: -0.2, xref: 'paper', yref: 'paper', xanchor: 'right', showarrow: false,
      text: `${missing.toLocaleString()} sites lack an effect or FDR`, font: { color: COLORS.muted, size: 11 },
    }];
  }
  return { data: traces, layout };
}

/** x is total-protein log2FC; y is original phosphosite log2FC for every method. */
export function buildProteinSiteFigure(
  rows: readonly SiteIndexRow[],
  contrast: string,
  fdrCutoff: number,
  fcCutoff: number,
  background: PlotBackground,
): ScatterFigure {
  if (!validThresholds(fdrCutoff, fcCutoff)) throw new RangeError('FDR must be ≤ 0.25 and |log2FC| must be ≥ 1.');
  const scoped = rows.filter((row) => row.contrast === contrast);
  const missingCount = scoped.filter((row) => !finite(row.protein_fc) || !finite(row.original_site_fc)).length;
  const layout = baseLayout('Protein versus original site effect', 390);
  layout.xaxis = { title: { text: 'Total-protein log2 fold change' }, gridcolor: COLORS.grid,
    zerolinecolor: COLORS.baseline, range: background.x_range };
  layout.yaxis = { title: { text: 'Original site log2 fold change' }, gridcolor: COLORS.grid,
    zerolinecolor: COLORS.baseline, range: background.y_range };
  layout.images = [backgroundLayout(background)];
  layout.shapes = [
    { type: 'line', x0: 0, x1: 0, y0: 0, y1: 1, yref: 'paper', line: { color: COLORS.baseline, width: 1 } },
    { type: 'line', x0: 0, x1: 1, xref: 'paper', y0: 0, y1: 0, line: { color: COLORS.baseline, width: 1 } },
  ];
  return {
    figure: {
      data: [
        ...scatterTraces(scoped, (row) => row.protein_fc, (row) => row.original_site_fc,
          fdrCutoff, fcCutoff, 'Total-protein log2FC', 'Original site log2FC'),
        focusedBackgroundTrace('Total-protein log2FC', 'Original site log2FC'),
      ],
      layout,
    },
    missingCount,
  };
}

/** Point-array updates for Plotly.restyle; null restores the unmodified figure. */
export function focusProteinTraces(figure: FigureSpec, proteinId: string | null): ProteinTraceUpdate {
  const update: ProteinTraceUpdate = { x: [], y: [], customdata: [] };
  for (const trace of figure.data) {
    if (!Array.isArray(trace.x) || !Array.isArray(trace.y) || !Array.isArray(trace.customdata)) {
      throw new TypeError('Protein focus requires site-point traces with x, y, and customdata arrays.');
    }
    const x = trace.x as unknown[];
    const y = trace.y as unknown[];
    const customdata = trace.customdata as unknown[];
    if (x.length !== y.length || x.length !== customdata.length) {
      throw new RangeError('Protein focus requires aligned site-point trace arrays.');
    }
    const selectedX: unknown[] = [];
    const selectedY: unknown[] = [];
    const selectedData: unknown[] = [];
    for (let index = 0; index < customdata.length; index += 1) {
      const point = customdata[index];
      if (proteinId !== null && (!Array.isArray(point) || point[0] !== proteinId)) {
        continue;
      }
      selectedX.push(x[index]);
      selectedY.push(y[index]);
      selectedData.push(point);
    }
    update.x.push(selectedX);
    update.y.push(selectedY);
    update.customdata.push(selectedData);
  }
  return update;
}

type PositionedSite = {
  measured: MeasuredSite;
  result: SiteResult | undefined;
  position: number;
  hasPosition: boolean;
  residue: string;
  effect: number | null;
  imputed: boolean;
  passing: boolean;
};

function localizationRange(site: MeasuredSite): string | null {
  const withBounds = site as MeasuredSite & {
    startModSite?: number | null;
    endModSite?: number | null;
  };
  if (!finite(withBounds.startModSite) || !finite(withBounds.endModSite)) return null;
  return `${withBounds.startModSite}–${withBounds.endModSite}`;
}

function significanceMark(fdr: number | null | undefined): string {
  if (!finite(fdr)) return '';
  if (fdr < 0.05) return '**';
  if (fdr < 0.2) return '*';
  return '';
}

function sitePosition(site: MeasuredSite): { position: number; hasPosition: boolean } {
  if (site.modAA === 'NotLoc' && finite(site.startModSite) && finite(site.endModSite)) {
    return { position: (site.startModSite + site.endModSite) / 2, hasPosition: true };
  }
  if (finite(site.posInProtein) && site.posInProtein > 0) {
    return { position: site.posInProtein, hasPosition: true };
  }
  return { position: 0, hasPosition: false };
}

function nToCSiteTraces(sites: PositionedSite[], contrast: string, proteinId: string, selectedSite: string | null) {
  const traces: Record<string, unknown>[] = [];
  const groups = new Map<string, PositionedSite[]>();
  for (const site of sites) {
    const key = `${site.residue}|${site.imputed}|${site.passing}`;
    const group = groups.get(key) ?? [];
    group.push(site);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const first = group[0];
    const color = RESIDUE_COLORS[first.residue] ?? RESIDUE_COLORS.NotLoc;
    const effectSites = group.filter((site) => finite(site.effect));
    if (effectSites.length > 0) {
      traces.push({
        type: 'scatter', mode: 'lines', showlegend: false, hoverinfo: 'skip',
        x: effectSites.flatMap((site) => [site.position, site.position, null]),
        y: effectSites.flatMap((site) => [0, site.effect, null]),
        line: { color, width: first.passing ? 2.2 : 1.2, dash: first.imputed ? 'dash' : 'solid' },
      });
    }
    const hover = group.map((site) => {
      const range = localizationRange(site.measured);
      const localization = site.residue === 'NotLoc'
        ? `Localization uncertain${range ? ` (${range})` : ''}`
        : `Residue ${site.residue}${site.hasPosition ? site.position : ' position unknown'}`;
      const effect = finite(site.effect) ? `log2FC ${site.effect.toFixed(3)}` : 'No estimable log2FC';
      const fdr = finite(site.result?.fdr) ? `FDR ${site.result.fdr.toPrecision(3)}` : 'FDR unavailable';
      const estimate = !site.result ? 'No statistical result' : site.imputed ? 'LOD imputed' : 'Observed estimate';
      return `<b>${escapeHtml(site.measured.site)}</b><br>${localization}<br>${effect} · ${fdr}`
        + `<br>${estimate}<extra></extra>`;
    });
    traces.push({
      type: 'scatter', mode: 'markers',
      name: `${first.residue}${first.imputed ? ' · imputed' : ''}`,
      legendgroup: `${first.residue}|${first.imputed}`,
      showlegend: !traces.some((trace) => trace.legendgroup === `${first.residue}|${first.imputed}`),
      x: group.map((site) => site.position),
      y: group.map((site) => finite(site.effect) ? site.effect : 0),
      customdata: group.map((site) => [proteinId, site.measured.site, contrast]),
      hovertemplate: group.map((_, index) => hover[index]),
      marker: {
        color,
        size: group.map((site) => site.measured.site === selectedSite ? 16 : site.passing ? 12 : 8),
        symbol: group.map((site) => !finite(site.effect) ? 'x' : site.imputed ? 'circle-open' : 'circle'),
        line: {
          color: group.map((site) => site.measured.site === selectedSite ? COLORS.selected : color),
          width: group.map((site) => site.measured.site === selectedSite ? 2.4 : 1.2),
        },
        opacity: group.map((site) => site.passing || site.measured.site === selectedSite ? 1 : 0.78),
      },
    });
  }
  return traces;
}

function featureTraces(features: FeaturePayload | null, sequenceLength: number): Record<string, unknown>[] {
  if (!features || features.status !== 'matched') return [];
  const traces: Record<string, unknown>[] = [];
  for (const feature of features.features) {
    if (!FEATURE_TYPES.includes(feature.type)) continue;
    if (feature.start_modifier !== 'EXACT' || feature.end_modifier !== 'EXACT') continue;
    if (!finite(feature.start) || !finite(feature.end)) continue;
    if (feature.start < 1 || feature.end < feature.start || feature.end > sequenceLength) continue;
    const row = FEATURE_TYPES.indexOf(feature.type);
    const label = feature.description?.trim() || feature.type;
    const evidenceEntries = feature.evidence
      ? JSON.parse(feature.evidence) as Array<{ evidenceCode: string; source?: string; id?: string }>
      : [];
    const evidenceLabels = [...new Set(evidenceEntries.map((entry) =>
      `${entry.evidenceCode}${entry.source ? ` (${entry.source}${entry.id ? `: ${entry.id}` : ''})` : ''}`))];
    const displayedEvidence = evidenceLabels.slice(0, 2).map(escapeHtml);
    const moreEvidence = evidenceLabels.length > 2 ? `<br>+${evidenceLabels.length - 2} more evidence records` : '';
    const evidence = displayedEvidence.length > 0
      ? `<br>Evidence: ${displayedEvidence.join('<br>')}${moreEvidence}` : '';
    const color = FEATURE_COLORS[feature.type];
    traces.push({
      type: 'scatter', mode: 'lines+markers', showlegend: false, xaxis: 'x', yaxis: 'y2',
      x: [feature.start, (feature.start + feature.end) / 2, feature.end],
      y: [row, row, row],
      line: { color, width: 13 },
      marker: { color, size: [0, 9, 0] },
      hoverlabel: { bgcolor: '#ffffff', bordercolor: color, font: { color: COLORS.ink, size: 12 }, align: 'left' },
      hovertemplate: `<b>${escapeHtml(feature.type)}</b>: ${escapeHtml(label)}<br>`
        + `${feature.start}–${feature.end}${evidence}<extra></extra>`,
    });
  }
  return traces;
}

function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function residueContextTraces(contexts: readonly ResidueContext[], plotLength: number): Record<string, unknown>[] {
  const byPosition = new Map<number, ResidueContext>();
  for (const context of [...contexts].sort((left, right) => left.fragment - right.fragment)) {
    if (Number.isInteger(context.position) && context.position >= 1 && context.position <= plotLength
      && !byPosition.has(context.position)) byPosition.set(context.position, context);
  }
  if (byPosition.size === 0) return [];
  const positions = Array.from({ length: plotLength }, (_, index) => byPosition.get(index + 1));
  const exposure = positions.map((row) => row?.is_exposed === null || !row ? null : row.is_exposed ? 0 : 1);
  const region = positions.map((row) => row?.is_idr === null || !row ? null : row.is_idr ? 1 : 0);
  const plddt = positions.map((row) => finite(row?.plddt) ? row.plddt : null);
  const text = (label: (row: ResidueContext) => string, present: Array<number | null>) =>
    positions.map((row, index) => row && present[index] !== null
      ? `${label(row)} · AlphaFold fragment ${row.fragment}` : null);
  const categoricalScale = (first: number, second: number) => [
    [0, hexColor(first)], [0.4999, hexColor(first)],
    [0.5, hexColor(second)], [1, hexColor(second)],
  ];
  const track = (name: string, row: number, values: Array<number | null>,
    labels: Array<string | null>, colorscale: Array<Array<number | string>>, zmax: number) => ({
    type: 'heatmap', name, xaxis: 'x', yaxis: 'y3', x0: 1, dx: 1, y0: row, dy: 1,
    z: [values], text: [labels], zmin: 0, zmax, colorscale, showscale: false,
    hoverongaps: false, ygap: 6, showlegend: false,
    hovertemplate: 'Residue %{x}<br>%{text}<extra></extra>',
  });
  return [
    track('Exposure', 2, exposure, text((row) => row.is_exposed ? 'Exposed' : 'Buried', exposure),
      categoricalScale(EXPOSURE_COLORS.exposed, EXPOSURE_COLORS.buried), 1),
    track('Region', 1, region, text((row) => row.is_idr ? 'Predicted IDR' : 'Structured', region),
      categoricalScale(REGION_COLORS.structured, REGION_COLORS.idr), 1),
    track('pLDDT', 0, plddt, text((row) => `pLDDT ${row.plddt?.toFixed(1)}`, plddt), [
      [0, hexColor(PLDDT_COLORS.veryLow)], [0.4999, hexColor(PLDDT_COLORS.veryLow)],
      [0.5, hexColor(PLDDT_COLORS.low)], [0.6999, hexColor(PLDDT_COLORS.low)],
      [0.7, hexColor(PLDDT_COLORS.confident)], [0.8999, hexColor(PLDDT_COLORS.confident)],
      [0.9, hexColor(PLDDT_COLORS.veryHigh)], [1, hexColor(PLDDT_COLORS.veryHigh)],
    ], 100),
  ];
}

/** Visible measured sites without a result or finite effect appear as baseline markers. */
export function buildNtoCFigure(
  protein: ProteinPayload,
  features: FeaturePayload | null,
  method: Method,
  contrast: string,
  selectedSite: string | null,
  fdrCutoff: number,
  fcCutoff: number,
  visibleSiteIds: ReadonlySet<string>,
  residueContext: readonly ResidueContext[] = [],
): FigureSpec {
  const results = new Map(protein.results.filter((row) => row.contrast === contrast)
    .map((row) => [row.site, row]));
  const sites: PositionedSite[] = protein.sites
    .filter((measured) => visibleSiteIds.has(measured.site))
    .map((measured) => {
      const result = results.get(measured.site);
      const { position, hasPosition } = sitePosition(measured);
      const residue = measured.modAA && RESIDUE_COLORS[measured.modAA] ? measured.modAA : 'NotLoc';
      return {
        measured, result, position, hasPosition, residue,
        effect: finite(result?.effect) ? result.effect : null,
        imputed: result?.site_estimate_type === 'lod_imputed',
        passing: result ? passes(result, fdrCutoff, fcCutoff) : false,
      };
    });
  const canonicalLength = protein.protein.sequence_length ?? protein.protein.protein_length ?? 0;
  const maxPosition = Math.max(0, ...sites.map((site) => site.position),
    residueContext.reduce((max, row) => Math.max(max, row.position), 0));
  const plotLength = Math.max(canonicalLength, maxPosition, 1);
  const finiteEffects = sites.flatMap((site) => finite(site.effect) ? [site.effect] : []);
  const proteinEffect = method === 'DPA'
    ? protein.results.find((row) => row.contrast === contrast && finite(row.protein_fc))?.protein_fc
    : null;
  if (finite(proteinEffect)) finiteEffects.push(proteinEffect);
  const maxAbsEffect = Math.max(1, ...finiteEffects.map(Math.abs));
  const labelSites = sites.filter((site) => significanceMark(site.result?.fdr) !== '');
  const featureData = featureTraces(features, canonicalLength);
  const contextData = residueContextTraces(residueContext, plotLength);
  const hasContext = contextData.length > 0;
  const layout = baseLayout(`${protein.protein.gene_name ?? protein.protein.protein_Id} · N to C`,
    hasContext ? 760 : featureData.length > 0 ? 500 : 380);
  layout.margin = { l: hasContext ? 120 : 75, r: 30, t: 62, b: 56 };
  layout.xaxis = {
    title: { text: 'Protein position (residue)' }, range: [-0.015 * plotLength, plotLength * 1.015],
    gridcolor: COLORS.grid, zeroline: false,
  };
  layout.yaxis = {
    title: { text: 'Method log2 fold change' },
    domain: hasContext ? [featureData.length > 0 ? 0.51 : 0.36, 1]
      : featureData.length > 0 ? [0.37, 1] : [0, 1],
    range: [-maxAbsEffect * 1.18, maxAbsEffect * 1.18], gridcolor: COLORS.grid,
    zerolinecolor: COLORS.baseline,
  };
  const shapes: Record<string, unknown>[] = [
    { type: 'line', x0: 0, x1: canonicalLength, y0: 0, y1: 0,
      line: { color: COLORS.baseline, width: 1.4 } },
  ];
  if (method === 'DPA' && finite(proteinEffect)) {
    shapes.unshift({
      type: 'rect', x0: 0, x1: canonicalLength,
      y0: Math.min(0, proteinEffect), y1: Math.max(0, proteinEffect),
      fillcolor: COLORS.proteinBand, line: { width: 0 }, layer: 'below',
    });
  }
  layout.shapes = shapes;
  if (featureData.length > 0) {
    const usedTypes = FEATURE_TYPES.filter((type) => featureData.some((trace) =>
      (trace.line as Record<string, unknown>).color === FEATURE_COLORS[type]));
    layout.yaxis2 = {
      title: { text: 'UniProt features' }, domain: hasContext ? [0.28, 0.42] : [0, 0.23],
      range: [-0.8, FEATURE_TYPES.length - 0.2],
      tickvals: usedTypes.map((type) => FEATURE_TYPES.indexOf(type)), ticktext: usedTypes,
      showgrid: false, zeroline: false, fixedrange: true,
    };
  }
  if (hasContext) {
    layout.yaxis3 = {
      domain: [0.03, 0.2], range: [-0.5, 2.5],
      tickvals: [0, 1, 2], ticktext: ['pLDDT', 'Region', 'Exposure'],
      showgrid: false, zeroline: false, fixedrange: true,
    };
  }
  const annotations: Record<string, unknown>[] = [];
  if (labelSites.length > 0) {
    annotations.push(...labelSites.map((site) => ({
      x: site.position,
      y: finite(site.effect) ? site.effect : 0,
      text: `${site.residue === 'NotLoc' ? '~' : site.residue}${site.hasPosition ? site.position : '?'}${significanceMark(site.result?.fdr)}`,
      showarrow: false, yshift: (site.effect ?? 0) >= 0 ? 17 : -17,
      font: { size: 10, color: COLORS.ink },
    })));
  }
  if (featureData.length === 0) {
    annotations.push({
      x: 1, y: hasContext ? 0.27 : -0.18, xref: 'paper', yref: 'paper', xanchor: 'right', showarrow: false,
      text: features?.status === 'matched' ? 'No displayed UniProt features' : `UniProt annotation: ${features?.status ?? 'unavailable'}`,
      font: { size: 11, color: COLORS.muted },
    });
  }
  const unknownPositions = sites.filter((site) => !site.hasPosition).length;
  if (unknownPositions > 0) {
    annotations.push({
      x: 0, y: 1.02, xref: 'paper', yref: 'paper', xanchor: 'left', showarrow: false,
      text: `${unknownPositions} site${unknownPositions === 1 ? '' : 's'} at unknown position (shown at axis origin)`,
      font: { size: 11, color: COLORS.muted },
    });
  }
  layout.annotations = annotations;
  const traces = nToCSiteTraces(sites, contrast, protein.protein.protein_Id, selectedSite);
  return { data: [...traces, ...featureData, ...contextData], layout };
}

/** Every sample stays in its condition group; absent values remain null. */
export function buildAbundanceFigure(
  evidence: EvidencePayload,
  method: Method,
  site: string,
  contrast: string,
): FigureSpec {
  const quantities: Array<{ field: 'site_abundance' | 'protein_abundance' | 'corrected_abundance'; label: string; unit: string }> = [
    { field: 'site_abundance', label: 'Enriched site', unit: 'Normalized log2 abundance' },
    { field: 'protein_abundance', label: 'Matched total protein', unit: 'Normalized log2 abundance' },
  ];
  if (method === 'CF-DPU') {
    quantities.push({ field: 'corrected_abundance', label: 'Corrected site minus protein', unit: 'Log2 difference' });
  }
  const conditionOrder = [...new Set(evidence.samples.map((sample) => sample.condition))];
  const measurements = evidence.measurements.filter((row) => row.site === site);
  const data: Record<string, unknown>[] = [];
  const layout = baseLayout(`${site} · ${contrast}`, 270 * quantities.length + 80);
  layout.margin = { l: 90, r: 30, t: 65, b: 70 };
  layout.showlegend = false;
  layout.boxmode = 'group';
  const annotations: Record<string, unknown>[] = [];
  quantities.forEach((quantity, index) => {
    const axisNumber = index + 1;
    const xref = axisNumber === 1 ? 'x' : `x${axisNumber}`;
    const yref = axisNumber === 1 ? 'y' : `y${axisNumber}`;
    const top = 1 - index / quantities.length - 0.04 / quantities.length;
    const bottom = 1 - (index + 1) / quantities.length + 0.08 / quantities.length;
    layout[`xaxis${axisNumber === 1 ? '' : axisNumber}`] = {
      domain: [0, 1], anchor: yref,
      categoryorder: 'array', categoryarray: conditionOrder,
      showticklabels: index === quantities.length - 1,
      title: index === quantities.length - 1 ? { text: 'Condition' } : undefined,
      showgrid: false,
    };
    layout[`yaxis${axisNumber === 1 ? '' : axisNumber}`] = {
      domain: [bottom, top], anchor: xref, title: { text: quantity.unit },
      gridcolor: COLORS.grid, zerolinecolor: COLORS.baseline,
    };
    const available = measurements.filter((row) => finite(row[quantity.field])).length;
    annotations.push({
      x: 0, y: top + 0.015, xref: 'paper', yref: 'paper', xanchor: 'left', showarrow: false,
      text: `<b>${quantity.label}</b> · ${available}/${measurements.length} samples with values`,
      font: { size: 12, color: COLORS.ink },
    });
    conditionOrder.forEach((condition, conditionIndex) => {
      const group = measurements.filter((row) => row.condition === condition);
      data.push({
        type: 'box', xaxis: xref, yaxis: yref, name: condition,
        x: group.map(() => condition),
        y: group.map((row) => finite(row[quantity.field]) ? row[quantity.field] : null),
        customdata: group.map((row) => [row.sample, row.condition]),
        boxpoints: 'all', jitter: 0.4, pointpos: 0,
        fillcolor: 'rgba(0,0,0,0)', line: { color: COLORS.muted, width: 1 },
        marker: { color: conditionIndex % 2 === 0 ? COLORS.down : COLORS.up, size: 8, opacity: 0.85 },
        hovertemplate: 'Sample %{customdata[0]}<br>Condition %{customdata[1]}<br>'
          + `${quantity.label}: %{y:.3f}<extra></extra>`,
      });
    });
  });
  layout.annotations = annotations;
  return { data, layout };
}

/** Render a prepared figure and connect plotted sites to the detail workspace. */
export async function renderFigure(
  element: HTMLDivElement,
  figure: FigureSpec,
  onSiteClick?: (point: SitePoint) => void,
  bundle: 'gl2d' | 'cartesian' = figure.data.some((trace) => trace.type === 'scattergl') ? 'gl2d' : 'cartesian',
): Promise<void> {
  const Plotly = bundle === 'gl2d'
    ? (await import('plotly.js-gl2d-dist-min')).default
    : (await import('plotly.js-cartesian-dist-min')).default;
  const graph = await Plotly.react(
    element,
    figure.data,
    figure.layout,
    { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['sendChartToCloud'] },
  );
  graph.removeAllListeners('plotly_click');
  if (onSiteClick) {
    graph.on('plotly_click', (event) => {
      const point = event.points[0]?.customdata;
      if (!Array.isArray(point) || point.length < 3) return;
      if (typeof point[0] !== 'string' || typeof point[1] !== 'string' || typeof point[2] !== 'string') return;
      onSiteClick({ proteinId: point[0], site: point[1], contrast: point[2] });
    });
  }
}
