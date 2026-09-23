import { UNAVAILABLE_STRUCTURE } from "../src/structural.js";
import assert from "node:assert/strict";
import test from "node:test";
import { computeLogos } from "../src/logo.js";
import { isSignificant, summarizeProteins } from "../src/summary.js";
import type { ProteinCatalogRow, SiteIndexRow } from "../src/types.js";

function protein(id: string, measured: number): ProteinCatalogRow {
  return {
    protein_Id: id,
    accession: id,
    gene_name: id,
    protein_length: 100,
    detected_sites: measured,
    measured_sites: measured,
    description: 'Example protein OS=Mus musculus OX=10090',
    uniprot_url: `https://www.uniprot.org/uniprotkb/${id}`,
    string_url: `https://string-db.org/cgi/network?identifiers=${id}&species=10090`,
    taxon_id: 10090,
    sequence_length: 100,
    annotation_status: "matched",
    structure_count: 1,
  };
}

function row(fields: Partial<SiteIndexRow>): SiteIndexRow {
  return {
    protein_Id: "P1",
    site: "S1",
    contrast: "A",
    posInProtein: 25,
    modAA: "S",
    sequence_window: "AAAAAAASAAAAAAA",
    gene_name: "P1",
    protein_length: 100,
    effect: 2,
    fdr: 0.01,
    p_value: 0.005,
    std_error: 0.1,
    site_estimate_type: "observed",
    protein_estimate_type: "observed",
    imputed: false,
    original_site_fc: 2,
    protein_fc: 0.5,
    accession: "P1",
    has_measurement: true,
    structure: UNAVAILABLE_STRUCTURE,
    ...fields,
  };
}

test("summary keeps measured proteins and scopes tested, significant, and directional counts", () => {
  const proteins = [protein("P1", 3), protein("P2", 2)];
  const rows = [
    row({ site: "S1", contrast: "A", effect: 2, fdr: 0.01 }),
    row({ site: "S1", contrast: "B", effect: -3, fdr: 0.02 }),
    row({ site: "S2", contrast: "A", effect: 4, fdr: 0.05 }),
    row({ site: "S3", contrast: "A", effect: null, fdr: null }),
  ];
  const cutoffs = { fdr: 0.05, absEffect: 1 };

  const all = summarizeProteins(proteins, rows, null, cutoffs);
  assert.deepEqual(
    [all[0].measured_sites, all[0].tested_sites, all[0].significant_sites,
      all[0].up_pairs, all[0].down_pairs, all[0].largest_effect],
    [3, 2, 1, 1, 1, 4],
  );
  assert.deepEqual(
    [all[1].measured_sites, all[1].tested_sites, all[1].significant_sites,
      all[1].largest_effect],
    [2, 0, 0, null],
  );

  const single = summarizeProteins(proteins, rows, "B", cutoffs);
  assert.deepEqual(
    [single[0].tested_sites, single[0].significant_sites,
      single[0].up_pairs, single[0].down_pairs, single[0].largest_effect],
    [1, 1, 0, 1, -3],
  );
  assert.equal(isSignificant(row({ effect: 1, fdr: 0.01 }), cutoffs), false);
  assert.equal(isSignificant(row({ effect: 2, fdr: 0.05 }), cutoffs), false);
  assert.equal(isSignificant(row({ effect: null, fdr: 0.01 }), cutoffs), false);
});

test("logos use centered windows and report missing windows separately", () => {
  const rows = [
    row({ site: "up1", sequence_window: "AAAAAAASAAAAAAA" }),
    row({ site: "up2", sequence_window: "XAAAAAASAAAAAAA" }),
    row({ site: "down", effect: -2, sequence_window: "CCCCCCCSCCCCCCC" }),
    row({ site: "invalid", sequence_window: "AAAAAAATAAAAAAA" }),
    row({ site: "other contrast", contrast: "B" }),
  ];
  const logos = computeLogos(rows, "A", { fdr: 0.05, absEffect: 1 });

  assert.equal(logos.upCount, 2);
  assert.equal(logos.downCount, 1);
  assert.equal(logos.invalidWindowCount, 1);
  assert.equal(logos.up?.[0].position, -7);
  assert.equal(logos.up?.[0].frequencies.A, 0.5);
  assert.equal(logos.up?.[0].frequencies.C, 0);
  assert.equal(logos.down?.[0].frequencies.C, 1);
  assert.equal(logos.difference?.[0].frequencies.A, 0.5);
  assert.equal(logos.difference?.[0].frequencies.C, -1);
  assert.equal(logos.up?.[7].position, 0);
  assert.equal(logos.up?.[7].frequencies.S, 1);

  const oneDirection = computeLogos(rows.slice(0, 2), "A", { fdr: 0.05, absEffect: 1 });
  assert.equal(oneDirection.down, null);
  assert.equal(oneDirection.difference, null);
});
