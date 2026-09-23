import type {
  AppData,
  MeasuredSite,
  Measurement,
  ProteinCatalogRow,
  ProteinDetail,
  ProteinFeature,
  ProteinInfo,
  RunManifest,
  SiteIndexRow,
  SiteResult,
  StructureFile,
} from "./types.js";
import { servedUrl } from "./served-url.js";

export type ParquetTableKey = keyof RunManifest["files"];

type ParquetProtein = Omit<ProteinInfo,
  "protein_length" | "detected_sites" | "measured_sites" | "taxon_id" | "sequence_length"> & {
  protein_length: number | bigint;
  detected_sites: number | bigint;
  measured_sites: number | bigint;
  taxon_id: number | bigint | null;
  sequence_length: number | bigint | null;
};

type ParquetMeasuredSite = Omit<MeasuredSite, "posInProtein" | "protein_length"> & {
  posInProtein: number | bigint | null;
  protein_length: number | bigint | null;
};

type ParquetSiteResult = Omit<SiteResult, "posInProtein" | "protein_length"> & {
  posInProtein: number | bigint | null;
  protein_length: number | bigint | null;
};

type ParquetFeature = Omit<ProteinFeature, "start" | "end"> & {
  start: number | bigint | null;
  end: number | bigint | null;
};

type ParquetStructure = Omit<StructureFile, "fragment" | "version" | "start" | "end"> & {
  protein_Id: string;
  accession: string;
  fragment: number | bigint;
  version: number | bigint;
  start: number | bigint;
  end: number | bigint | null;
};

const parquetTables = new Map<string, Promise<unknown[]>>();

async function getFile(path: string, baseUrl: string): Promise<Response> {
  const url = servedUrl(path, baseUrl);
  const response = await fetch(url, { mode: "same-origin", redirect: "error" });
  if (!response.ok) {
    throw new Error(`Could not load ${url.pathname}: HTTP ${response.status}`);
  }
  return response;
}

function siteKey(proteinId: string, site: string): string {
  return `${proteinId}\u0000${site}`;
}

function numberOrNull(value: number | bigint | null): number | null {
  return value === null ? null : Number(value);
}

function normalizeProtein(row: ParquetProtein, structureCount: number): ProteinCatalogRow {
  return {
    ...row,
    protein_length: Number(row.protein_length),
    detected_sites: Number(row.detected_sites),
    measured_sites: Number(row.measured_sites),
    taxon_id: numberOrNull(row.taxon_id),
    sequence_length: numberOrNull(row.sequence_length),
    structure_count: structureCount,
  };
}

function normalizeSite(row: ParquetMeasuredSite): MeasuredSite {
  return {
    ...row,
    posInProtein: numberOrNull(row.posInProtein),
    protein_length: numberOrNull(row.protein_length),
  };
}

function normalizeResult(row: ParquetSiteResult): SiteResult {
  return {
    ...row,
    posInProtein: numberOrNull(row.posInProtein),
    protein_length: numberOrNull(row.protein_length),
  };
}

function normalizeFeature(row: ParquetFeature): ProteinFeature {
  return { ...row, start: numberOrNull(row.start), end: numberOrNull(row.end) };
}

function normalizeStructure(row: ParquetStructure): StructureFile {
  return {
    file: row.file,
    fragment: Number(row.fragment),
    version: Number(row.version),
    start: Number(row.start),
    end: numberOrNull(row.end),
    url: row.url,
  };
}

async function loadParquetRows<T>(path: string, baseUrl: string): Promise<T[]> {
  const url = servedUrl(path, baseUrl).href;
  let pending = parquetTables.get(url);
  if (!pending) {
    pending = (async () => {
      const response = await getFile(path, baseUrl);
      const [{ parquetReadObjects }, { compressors }] = await Promise.all([
        import("hyparquet"),
        import("hyparquet-compressors"),
      ]);
      return parquetReadObjects({ file: await response.arrayBuffer(), compressors });
    })();
    parquetTables.set(url, pending);
  }
  return pending as Promise<T[]>;
}

export async function loadAppData(baseUrl = document.baseURI): Promise<AppData> {
  const response = await getFile("data/run.json", baseUrl);
  const run = (await response.json()) as RunManifest;
  if (run.kind !== "proptm3d-prepared-method" || run.schema_version !== "2") {
    throw new Error("This browser app requires a proptm3d prepared method with payload schema 2.");
  }
  const [proteinRows, stats, sites, structures] = await Promise.all([
    loadParquetTable<ParquetProtein>(run, "proteins_parquet", baseUrl),
    loadParquetTable<ParquetSiteResult>(run, "site_stats_parquet", baseUrl),
    loadParquetTable<ParquetMeasuredSite>(run, "sites_parquet", baseUrl),
    loadParquetTable<ParquetStructure>(run, "structures_parquet", baseUrl),
  ]);
  const structureCounts = new Map<string, number>();
  for (const row of structures) {
    structureCounts.set(row.protein_Id, (structureCounts.get(row.protein_Id) ?? 0) + 1);
  }
  const proteins = proteinRows.map((row) => normalizeProtein(row, structureCounts.get(row.protein_Id) ?? 0));
  const siteMetadata = new Map(sites.map((site) => [siteKey(site.protein_Id, site.site), site]));
  const siteIndex: SiteIndexRow[] = stats.map((row) => {
    const site = siteMetadata.get(siteKey(row.protein_Id, row.site));
    if (!site) {
      throw new Error(`No measured-site metadata for ${row.protein_Id} / ${row.site}.`);
    }
    return { ...normalizeResult(row), accession: site.accession, has_measurement: site.has_measurement };
  });
  return { run, proteins, siteIndex };
}

export async function loadProteinDetail(
  protein: ProteinCatalogRow,
  run: RunManifest,
  baseUrl = document.baseURI,
): Promise<ProteinDetail> {
  const [sites, stats, measurements, features, structures] = await Promise.all([
    loadParquetTable<ParquetMeasuredSite>(run, "sites_parquet", baseUrl),
    loadParquetTable<ParquetSiteResult>(run, "site_stats_parquet", baseUrl),
    loadParquetTable<Measurement>(run, "measurements_parquet", baseUrl),
    loadParquetTable<ParquetFeature>(run, "protein_features_parquet", baseUrl),
    loadParquetTable<ParquetStructure>(run, "structures_parquet", baseUrl),
  ]);
  return {
    protein,
    sites: sites.filter((row) => row.protein_Id === protein.protein_Id).map(normalizeSite),
    results: stats.filter((row) => row.protein_Id === protein.protein_Id).map(normalizeResult),
    structures: structures.filter((row) => row.protein_Id === protein.protein_Id).map(normalizeStructure),
    evidence: {
      samples: run.samples,
      measurements: measurements.filter((row) => row.protein_Id === protein.protein_Id),
    },
    features: {
      status: protein.annotation_status,
      features: features.filter((row) => row.protein_Id === protein.protein_Id).map(normalizeFeature),
    },
  };
}

export async function loadParquetTable<T>(
  run: RunManifest,
  table: ParquetTableKey,
  baseUrl = document.baseURI,
): Promise<T[]> {
  return loadParquetRows<T>(run.files[table], baseUrl);
}
