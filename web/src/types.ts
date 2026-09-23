export type Method = "DPA" | "DPU" | "CF-DPU";

export interface Sample {
  sample: string;
  condition: string;
}

export interface RunManifest {
  kind: "proptm3d-prepared-method";
  schema_version: "2";
  method: Method;
  contrasts: string[];
  samples: Sample[];
  sample_name_field: string;
  sample_condition_field: string;
  proteome: string;
  taxon_id: number;
  uniprot_release: string;
  alphafold_archive_version: string;
  counts: {
    proteins: number;
    measured_sites: number;
    result_rows: number;
    complete_result_sites: number;
    complete_result_proteins: number;
    complete_result_structures: number;
    measured_sites_without_result: number;
    annotation_matched: number;
    annotation_missing: number;
    annotation_mismatch: number;
    without_features: number;
    with_structures: number;
  };
  files: {
    proteins_parquet: string;
    sites_parquet: string;
    site_stats_parquet: string;
    measurements_parquet: string;
    protein_features_parquet: string;
    structures_parquet: string;
  };
}

export interface ProteinInfo {
  protein_Id: string;
  accession: string;
  gene_name: string;
  description: string | null;
  uniprot_url: string | null;
  string_url: string | null;
  protein_length: number;
  detected_sites: number;
  measured_sites: number;
  taxon_id: number | null;
  sequence_length: number | null;
  annotation_status: string;
}

export interface ProteinCatalogRow extends ProteinInfo {
  structure_count: number;
}

export interface SiteResult {
  protein_Id: string;
  site: string;
  contrast: string;
  posInProtein: number | null;
  modAA: string | null;
  sequence_window: string | null;
  gene_name: string;
  protein_length: number | null;
  effect: number | null;
  fdr: number | null;
  p_value: number | null;
  std_error: number | null;
  site_estimate_type: string | null;
  protein_estimate_type: string | null;
  imputed: boolean;
  original_site_fc: number | null;
  protein_fc: number | null;
  // These are absent from the current prepared data; future payloads may supply them.
  startModSite?: number | null;
  endModSite?: number | null;
}

export interface SiteIndexRow extends SiteResult {
  accession: string;
  has_measurement: boolean;
}

export interface MeasuredSite {
  protein_Id: string;
  site: string;
  "fasta.id": string;
  gene_name: string;
  protein_length: number | null;
  posInProtein: number | null;
  modAA: string | null;
  SequenceWindow: string | null;
  accession: string;
  has_measurement: boolean;
  startModSite?: number | null;
  endModSite?: number | null;
}

export interface StructureFile {
  file: string;
  fragment: number;
  version: number;
  start: number;
  end: number | null;
  url: string;
}

export interface ProteinPayload {
  protein: ProteinInfo;
  sites: MeasuredSite[];
  results: SiteResult[];
  structures: StructureFile[];
}

export interface Measurement {
  protein_Id: string;
  site: string;
  sample: string;
  condition: string;
  site_abundance: number | null;
  protein_abundance: number | null;
  corrected_abundance: number | null;
}

export interface EvidencePayload {
  samples: Sample[];
  measurements: Measurement[];
}

export interface ProteinFeature {
  accession: string;
  type: string;
  description: string | null;
  start: number | null;
  end: number | null;
  start_modifier: string | null;
  end_modifier: string | null;
  evidence: string | null;
  protein_Id: string;
}

export interface FeaturePayload {
  status: string;
  features: ProteinFeature[];
}

export interface ProteinDetail extends ProteinPayload {
  evidence: EvidencePayload;
  features: FeaturePayload;
}

export interface AppData {
  run: RunManifest;
  proteins: ProteinCatalogRow[];
  siteIndex: SiteIndexRow[];
}

export interface Thresholds {
  fdr: number;
  absEffect: number;
}
