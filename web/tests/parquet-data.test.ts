import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { loadAppData, loadParquetTable, loadProteinDetail } from "../src/data.js";
import type { RunManifest } from "../src/types.js";

// One synthetic Parquet row carries the fields used by each v2 table.
const parquetFixture = gunzipSync(Buffer.from([
  "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",
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

    const detail = await loadProteinDetail(data.proteins[0], data.run, baseUrl);
    assert.equal(detail.sites[0].posInProtein, 10);
    assert.equal(detail.results[0].effect, 2);
    assert.equal(detail.evidence.measurements[0].site_abundance, null);
    assert.equal(detail.evidence.measurements[0].protein_abundance, 15);
    assert.equal(detail.evidence.measurements[0].corrected_abundance, null);
    assert.equal(detail.features.features[0].start, 5);
    assert.equal(detail.structures[0].fragment, 1);
    assert.equal(detail.structures[0].end, 50);
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
