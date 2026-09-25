import {
  createViewer,
  GradientType,
  SurfaceType,
  type AtomSpec,
  type GLModel,
  type GLViewer,
  type SurfaceStyleSpec,
} from '3dmol/build/3Dmol.es6.js';
import { servedUrl } from './served-url.js';
import { structureLabel } from './structural.js';
import { featureColor, residueColor, UNANNOTATED_COLOR, type StructureColoring } from './structure-colors.js';
import type { ProteinFeature, ResidueContext, SiteStructure } from './types.js';

export type StructureRepresentation = 'cartoon' | 'backbone' | 'surface';
export type { StructureColoring } from './structure-colors.js';

export interface StructureModel {
  url: string;
  fragment: number;
  start: number | null;
  end: number | null;
}

export interface SiteMarker {
  site: string;
  label: string;
  posInProtein: number | null;
  effect: number | null;
  fdr: number | null;
  structure: SiteStructure;
}



export interface StructureCutoffs {
  fdr: number;
  minAbsoluteEffect: number;
}

export interface StructureStatus {
  state: 'ready' | 'absent' | 'error';
  message: string;
  mappedSites: number;
  visibleSites: number;
  totalSites: number;
  fragment: number | null;
}

interface ResiduePoint {
  atom: AtomSpec;
  modelIndex: number;
}

interface LoadedModel {
  model: GLModel;
  info: StructureModel;
}

const DEFAULT_CUTOFFS: StructureCutoffs = { fdr: 0.05, minAbsoluteEffect: 0 };
const NEUTRAL_COLOR = 0xa9b6c3;
const NO_EFFECT_COLOR = 0x8b96a3;

function plddtColor(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return NO_EFFECT_COLOR;
  if (value >= 90) return 0x0053d6;
  if (value >= 70) return 0x65cbf3;
  if (value >= 50) return 0xffdb13;
  return 0xff7d45;
}

function positionColor(position: number, sequenceLength: number): number {
  const fraction = Math.max(0, Math.min(1, (position - 1) / Math.max(1, sequenceLength - 1)));
  const hue = 220 * (1 - fraction);
  const rgb = (channel: number) => {
    const k = (channel + hue / 30) % 12;
    const value = 0.57 - 0.34 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * value);
  };
  return (rgb(0) << 16) | (rgb(8) << 8) | rgb(4);
}

function markerColor(effect: number | null): number {
  if (effect === null || !Number.isFinite(effect)) return NO_EFFECT_COLOR;
  const amount = Math.min(Math.abs(effect) / 2, 1);
  const end = effect > 0 ? [205, 65, 63] : [49, 105, 184];
  const rgb = end.map((component) => Math.round(232 + (component - 232) * amount));
  return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
}

class ColorGradient extends GradientType {
  constructor(
    private readonly minimum: number,
    private readonly maximum: number,
    private readonly colorAt: (value: number) => number,
  ) {
    super();
  }

  range(): [number, number] {
    return [this.minimum, this.maximum];
  }

  valueToHex(value: number): number {
    return this.colorAt(value);
  }
}

const plddtGradient = new ColorGradient(0, 100, plddtColor);

/** Render one AlphaFold fragment at a time; selecting a site switches fragments when needed. */
export class StructureViewer {
  private viewer: GLViewer | null = null;
  private loadedModels: LoadedModel[] = [];
  private residues = new Map<number, ResiduePoint>();
  private sites: SiteMarker[] = [];
  private selectedSite: string | null = null;
  private cutoffs: StructureCutoffs = DEFAULT_CUTOFFS;
  private sequenceLength = 1;
  private residueContexts = new Map<string, ResidueContext>();
  private features: ProteinFeature[] = [];
  private featureColors = new Map<number, number>();
  private activeModelIndex = 0;
  private representation: StructureRepresentation = 'cartoon';
  private coloring: StructureColoring = 'plddt';
  private requestController: AbortController | null = null;
  private loadGeneration = 0;
  private surfaceGeneration = 0;
  private currentStatus: StructureStatus = {
    state: 'absent', message: 'No AlphaFold model is available for this protein.',
    mappedSites: 0, visibleSites: 0, totalSites: 0, fragment: null,
  };

  constructor(
    private readonly container: HTMLElement,
    private readonly onSiteSelect: (site: string) => void,
  ) {}

  get activeFragment(): number | null {
    return this.loadedModels[this.activeModelIndex]?.info.fragment ?? null;
  }

  get status(): StructureStatus {
    return { ...this.currentStatus };
  }

  async load(models: StructureModel[], sites: SiteMarker[], sequenceLength: number,
    contexts: ResidueContext[] = [], features: ProteinFeature[] = []): Promise<StructureStatus> {
    this.loadGeneration += 1;
    const generation = this.loadGeneration;
    this.requestController?.abort();
    const controller = new AbortController();
    this.requestController = controller;
    this.clearModels();
    this.sites = sites;
    this.selectedSite = null;
    this.sequenceLength = Math.max(1, sequenceLength);
    this.residueContexts = new Map(contexts.map((row) => [`${row.fragment}:${row.position}`, row]));
    this.features = features;
    this.featureColors.clear();

    if (models.length === 0) {
      this.currentStatus = {
        state: 'absent', message: 'No AlphaFold model is available for this protein.',
        mappedSites: 0, visibleSites: 0, totalSites: sites.length, fragment: null,
      };
      return this.status;
    }

    try {
      const buffers = await Promise.all(models.map(async ({ url }) => {
        const response = await fetch(servedUrl(url), {
          signal: controller.signal, mode: 'same-origin', redirect: 'error',
        });
        if (!response.ok) throw new Error(`Structure request failed (${response.status}): ${url}`);
        return response.arrayBuffer();
      }));
      if (generation !== this.loadGeneration) return this.status;

      this.viewer ??= createViewer(this.container, { backgroundColor: '#f8fafc' });
      this.loadedModels = models.map((info, index) => {
        const bytes = new Uint8Array(buffers[index]);
        const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
        const input = gzipped ? buffers[index] : new TextDecoder().decode(buffers[index]);
        const model = this.viewer!.addModel(input, gzipped ? 'cif.gz' : 'cif');
        return { model, info };
      });
      this.indexResidues();
      if (this.residues.size === 0) throw new Error('The AlphaFold file has no protein residues.');
      this.activeModelIndex = 0;
      this.showActiveFragment();
      this.viewer.zoomTo({ model: this.loadedModels[0].model.getID() });
      this.currentStatus = this.readyStatus();
      return this.status;
    } catch (error) {
      if (generation !== this.loadGeneration) return this.status;
      this.clearModels();
      this.currentStatus = {
        state: 'error', message: error instanceof Error ? error.message : 'The structure could not be loaded.',
        mappedSites: 0, visibleSites: 0, totalSites: sites.length, fragment: null,
      };
      return this.status;
    }
  }

  setSites(sites: SiteMarker[], selectedSite: string | null, cutoffs: StructureCutoffs): void {
    const selectionChanged = selectedSite !== this.selectedSite;
    this.sites = sites;
    this.cutoffs = cutoffs;
    this.selectedSite = selectedSite;
    if (selectionChanged) this.activateSelectedFragment();
    this.drawMarkers();
    if (this.loadedModels.length > 0) this.currentStatus = this.readyStatus();
  }

  setRepresentation(representation: StructureRepresentation): void {
    if (representation === this.representation) return;
    this.representation = representation;
    this.applyAppearance();
  }

  setColoring(coloring: StructureColoring): void {
    if (coloring === this.coloring) return;
    this.coloring = coloring;
    this.applyAppearance();
  }

  selectSite(site: string | null): void {
    this.selectedSite = site;
    this.activateSelectedFragment();
    this.drawMarkers();
    if (this.loadedModels.length > 0) this.currentStatus = this.readyStatus();
  }

  resize(): void {
    this.viewer?.resize().render();
  }

  dispose(): void {
    this.loadGeneration += 1;
    this.requestController?.abort();
    this.clearModels();
    this.viewer?.clear();
    this.viewer = null;
    this.container.replaceChildren();
  }

  private clearModels(): void {
    this.surfaceGeneration += 1;
    this.viewer?.removeAllSurfaces().removeAllShapes().removeAllLabels().removeAllModels().render();
    this.loadedModels = [];
    this.residues.clear();
  }

  private indexResidues(): void {
    this.residues.clear();
    this.loadedModels.forEach(({ model, info }, modelIndex) => {
      if (info.fragment > 1 && info.start === null) {
        throw new Error(`AlphaFold fragment ${info.fragment} has no protein-coordinate start.`);
      }
      const alphaCarbons = model.selectedAtoms({ atom: 'CA' });
      const numbers = alphaCarbons.map((atom) => atom.resi).filter((n): n is number => n !== undefined);
      if (numbers.length === 0) return;
      const first = Math.min(...numbers);
      const offset = info.start !== null && first < info.start ? info.start - first : 0;
      const atoms = model.selectedAtoms({});
      for (const atom of atoms) {
        if (atom.resi !== undefined) {
          const position = atom.resi + offset;
          const context = this.residueContexts.get(`${info.fragment}:${position}`);
          let uniprotColor = this.featureColors.get(position);
          if (uniprotColor === undefined) {
            uniprotColor = featureColor(position, this.features);
            this.featureColors.set(position, uniprotColor);
          }
          atom.properties = {
            ...atom.properties,
            ptmGlobalPosition: position,
            ptmExposureColor: residueColor('exposure', context),
            ptmRegionColor: residueColor('region', context),
            ptmFeatureColor: uniprotColor,
          };
        }
      }
      for (const atom of alphaCarbons) {
        const position = atom.resi! + offset;
        if (!this.residues.has(position)) this.residues.set(position, { atom, modelIndex });
      }
      for (const atom of atoms) {
        if (atom.resi === undefined ||
          (atom.atom !== 'OG' && atom.atom !== 'OG1' && atom.atom !== 'OH')) continue;
        const point = this.residues.get(atom.resi + offset);
        if (point?.modelIndex === modelIndex) point.atom = atom;
      }
    });
  }

  private readyStatus(): StructureStatus {
    const mapped = this.sites.filter((site) => site.posInProtein !== null &&
      this.residues.has(site.posInProtein));
    const visibleSites = mapped.filter((site) =>
      this.residues.get(site.posInProtein!)!.modelIndex === this.activeModelIndex).length;
    const fragment = this.loadedModels[this.activeModelIndex].info.fragment;
    return {
      state: 'ready',
      message: `${mapped.length} of ${this.sites.length} sites mapped; showing AlphaFold fragment ${fragment} with ${visibleSites} ${visibleSites === 1 ? 'marker' : 'markers'}.`,
      mappedSites: mapped.length, visibleSites, totalSites: this.sites.length, fragment,
    };
  }

  private activateSelectedFragment(): void {
    if (!this.selectedSite || this.loadedModels.length === 0) return;
    const position = this.sites.find((site) => site.site === this.selectedSite)?.posInProtein;
    if (position === null || position === undefined) return;
    const point = this.residues.get(position);
    if (!point) return;
    if (point.modelIndex !== this.activeModelIndex) {
      this.activeModelIndex = point.modelIndex;
      this.showActiveFragment();
      this.viewer?.zoomTo({ model: this.loadedModels[this.activeModelIndex].model.getID() });
    }
    this.viewer?.center({ x: point.atom.x, y: point.atom.y, z: point.atom.z }, 250).render();
  }

  private showActiveFragment(): void {
    this.loadedModels.forEach(({ model }, index) => {
      if (index === this.activeModelIndex) model.show();
      else model.hide();
    });
    this.applyAppearance();
    this.drawMarkers();
  }

  private atomColor(atom: AtomSpec): number {
    if (this.coloring === 'neutral') return NEUTRAL_COLOR;
    if (this.coloring === 'plddt') return plddtColor(atom.b);
    if (this.coloring === 'exposure') return Number(atom.properties?.ptmExposureColor ?? UNANNOTATED_COLOR);
    if (this.coloring === 'region') return Number(atom.properties?.ptmRegionColor ?? UNANNOTATED_COLOR);
    if (this.coloring === 'uniprot') return Number(atom.properties?.ptmFeatureColor ?? UNANNOTATED_COLOR);
    const position = Number(atom.properties?.ptmGlobalPosition);
    return Number.isFinite(position) ? positionColor(position, this.sequenceLength) : NEUTRAL_COLOR;
  }

  private surfaceStyle(): SurfaceStyleSpec {
    if (this.coloring === 'neutral') return { color: NEUTRAL_COLOR, opacity: 0.72 };
    if (this.coloring === 'plddt') {
      return { colorscheme: { prop: 'b', gradient: plddtGradient }, opacity: 0.72 };
    }
    if (this.coloring === 'exposure' || this.coloring === 'region' || this.coloring === 'uniprot') {
      const prop = this.coloring === 'exposure' ? 'ptmExposureColor'
        : this.coloring === 'region' ? 'ptmRegionColor' : 'ptmFeatureColor';
      const gradient = new ColorGradient(0, 0xffffff, (color) => color);
      return { colorscheme: { prop, gradient }, opacity: 0.72 };
    }
    const length = this.sequenceLength;
    const gradient = new ColorGradient(1, length, (position) => positionColor(position, length));
    return { colorscheme: { prop: 'ptmGlobalPosition', gradient }, opacity: 0.72 };
  }

  private applyAppearance(): void {
    const viewer = this.viewer;
    const active = this.loadedModels[this.activeModelIndex];
    if (!viewer || !active) return;
    const generation = ++this.surfaceGeneration;
    viewer.removeAllSurfaces();
    active.model.setStyle({}, {});
    if (this.representation === 'cartoon') {
      active.model.setStyle({}, { cartoon: { colorfunc: (atom: AtomSpec) => this.atomColor(atom) } });
    } else if (this.representation === 'backbone') {
      active.model.setStyle({}, {
        cartoon: { style: 'trace', thickness: 0.3, colorfunc: (atom: AtomSpec) => this.atomColor(atom) },
      });
    } else {
      const result: Promise<number> = viewer.addSurface(
        SurfaceType.SAS, this.surfaceStyle(), { model: active.model.getID() },
      );
      void result.then(() => {
        if (generation === this.surfaceGeneration) viewer.render();
      });
    }
    viewer.render();
  }

  private drawMarkers(): void {
    const viewer = this.viewer;
    if (!viewer || this.loadedModels.length === 0) return;
    viewer.removeAllShapes();
    viewer.removeAllLabels();
    for (const site of this.sites) {
      if (site.posInProtein === null) continue;
      const point = this.residues.get(site.posInProtein);
      if (!point || point.modelIndex !== this.activeModelIndex) continue;
      const selected = site.site === this.selectedSite;
      const significant = site.fdr !== null && Number.isFinite(site.fdr) &&
        site.effect !== null && Number.isFinite(site.effect) &&
        site.fdr < this.cutoffs.fdr && Math.abs(site.effect) > this.cutoffs.minAbsoluteEffect;
      const center = { x: point.atom.x!, y: point.atom.y!, z: point.atom.z! };
      const radius = selected ? 2.7 : significant ? 2.15 : 1.7;
      const tooltip = structureLabel(site.label, site.structure);
      let label: ReturnType<GLViewer['addLabel']> | null = null;
      viewer.addSphere({
        center, radius,
        color: markerColor(site.effect), opacity: significant || selected ? 1 : 0.75,
        clickable: true, callback: () => this.onSiteSelect(site.site),
        hoverable: true,
        hover_callback: () => {
          label ??= viewer.addLabel(tooltip, {
            position: center, fontSize: 12, fontColor: '#16191d', backgroundColor: '#ffffff',
            backgroundOpacity: 0.92, borderColor: '#d8dde3', borderThickness: 1, inFront: true,
          });
          viewer.render();
        },
        unhover_callback: () => {
          if (label) viewer.removeLabel(label);
          label = null;
          viewer.render();
        },
      });
    }
    viewer.render();
  }
}
