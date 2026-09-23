import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { loadAppData, loadParquetTable, loadProteinDetail } from "../src/data.js";
import type { RunManifest } from "../src/types.js";

// One synthetic Parquet row carries the fields used by each v2 table.
const parquetFixture = gunzipSync(Buffer.from([
  "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",
  "njV2i0kAAA==",
].join(""), "base64"));
const baseUrl = "https://fixture.proptm3d.test/DPA/";
const run = {
  kind: "proptm3d-prepared-method",
  schema_version: "2",
  method: "DPA",
  contrasts: ["A"],
  samples: [{ sample: "sample1", condition: "control" }],
  files: {
    proteins_parquet: "tables/proteins.parquet",
    sites_parquet: "tables/sites.parquet",
    site_stats_parquet: "tables/site_stats.parquet",
    measurements_parquet: "tables/measurements.parquet",
    protein_features_parquet: "tables/protein_features.parquet",
    structures_parquet: "tables/structures.parquet",
    site_structural_context_parquet: "tables/site_structural_context.parquet",
  },
} as RunManifest;

test("v2 browser data comes entirely from Parquet and preserves nulls", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.mode, "same-origin");
    assert.equal(init?.redirect, "error");
    const url = new URL(input.toString());
    requests.push(url.pathname);
    if (url.pathname.endsWith("/data/run.json")) {
      return new Response(JSON.stringify(run));
    }
    assert.ok(url.pathname.endsWith(".parquet"), `Unexpected data request: ${url.pathname}`);
    return new Response(parquetFixture.buffer.slice(
      parquetFixture.byteOffset, parquetFixture.byteOffset + parquetFixture.byteLength,
    ) as ArrayBuffer);
  }) as typeof fetch;

  try {
    const data = await loadAppData(baseUrl);
    assert.equal(data.proteins.length, 1);
    assert.equal(data.proteins[0].structure_count, 1);
    assert.equal(data.siteIndex.length, 1);
    assert.equal(data.siteIndex[0].posInProtein, 10);
    assert.equal(data.siteIndex[0].effect, 2);
    assert.equal(data.siteIndex[0].fdr, 0.01);
    assert.equal(data.siteIndex[0].has_measurement, true);
    assert.equal(data.siteIndex[0].structure.exposure, "exposed");
    assert.equal(data.siteIndex[0].structure.region, "idr");
    assert.equal(data.siteIndex[0].structure.plddt, 64.2);

    const detail = await loadProteinDetail(data.proteins[0], data.run, baseUrl);
    assert.equal(detail.sites[0].posInProtein, 10);
    assert.equal(detail.results[0].effect, 2);
    assert.equal(detail.evidence.measurements[0].site_abundance, null);
    assert.equal(detail.evidence.measurements[0].protein_abundance, 15);
    assert.equal(detail.evidence.measurements[0].corrected_abundance, null);
    assert.equal(detail.features.features[0].start, 5);
    assert.equal(detail.structures[0].fragment, 1);
    assert.equal(detail.structures[0].end, 50);
    assert.equal(detail.structures[0].pae_url, "pae/AF-P1-F1-predicted_aligned_error_v6.json.gz");
    assert.equal(detail.context.length, 1);
    assert.equal(detail.context[0].model_id, "AF-P1-F1");
    assert.equal(detail.context[0].fragment, 1);
    assert.equal(detail.context[0].model_position, 10);
    assert.equal(detail.context[0].nAA_12_70_pae, 3);
    assert.equal(typeof detail.context[0].nAA_24_180_pae, "number");
    assert.equal(detail.context[0].mapping_status, "matched");
    assert.deepEqual(detail.evidence.samples, run.samples);
    assert.deepEqual(requests.sort(), [
      "/DPA/data/run.json",
      ...Object.values(run.files).map((path) => `/DPA/${path}`),
    ].sort());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an external Parquet path is rejected before fetch", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    throw new Error("fetch must not be called");
  }) as typeof fetch;
  try {
    const externalRun = {
      ...run,
      files: { ...run.files, proteins_parquet: "https://www.uniprot.org/uniprotkb/P12345" },
    };
    await assert.rejects(
      loadParquetTable(externalRun, "proteins_parquet", baseUrl),
      /Refusing to load a URL outside the served app/,
    );
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
