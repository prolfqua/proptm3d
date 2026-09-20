import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CATEGORY_COLOR, CONTEXT_COLOR, LABEL_LIMIT, Session } from '../../src/proptm3d/assets/lib/session.js'

const catalog = () => ({
  fdr_threshold: 0.25,
  proteins: [
    {
      gene_name: 'MAPK1',
      uniprot_acc: 'P28482',
      ptm_count: 3,
      sig_count: 2,
      max_log2fc: -2,
      contrast_stats: { A_vs_B: { sig_count: 1, max_log2fc: -2 }, C_vs_B: { sig_count: 1, max_log2fc: 0.3 } },
      data_file: 'data/MAPK1_P28482.cbor',
      pml_file: 'MAPK1_P28482_pymol.pml'
    },
    {
      gene_name: 'TPR',
      uniprot_acc: 'P12270',
      ptm_count: 1,
      sig_count: 0,
      max_log2fc: 0.1,
      contrast_stats: { A_vs_B: { sig_count: 0, max_log2fc: 0.1 } },
      data_file: 'data/TPR_P12270.cbor',
      pml_file: 'TPR_P12270_pymol.pml'
    }
  ]
})

const categories = () => ({
  contrasts: {
    A_vs_B: {
      windows: ['AASAA', 'ATTAA'],
      proteins: ['P28482', 'P12270'],
      terms: [
        {
          term_id: 'CDK1',
          source: 'KinaseLib',
          nes: 1.9,
          fdr: 0.001,
          leading: [0],
          members: [0, 1],
          leading_proteins: [0],
          members_proteins: [0, 1],
          leading_sites_catalog: 1,
          leading_sites_total: 4,
          members_sites_catalog: 2,
          members_sites_total: 6
        }
      ]
    }
  }
})

const payload = () => ({
  gene_name: 'MAPK1',
  uniprot_acc: 'P28482',
  seq_len: 360,
  protein_length: 360,
  ptms: [
    { res_num: 2, mod_aa: 'S', log2fc: 1.5, fdr: 0.01, contrast: 'A_vs_B', seq_window: 'aasaa', plddt: 88 },
    { res_num: 3, mod_aa: 'T', log2fc: -2, fdr: 0.2, contrast: 'A_vs_B', seq_window: 'ATTAA', plddt: 60 },
    { res_num: 4, mod_aa: 'Y', log2fc: 0.3, fdr: 0.04, contrast: 'C_vs_B', seq_window: 'AYYAA', plddt: null }
  ]
})

test('contrasts are the sorted union of catalog stats and category blocks', () => {
  const session = new Session(catalog(), categories())
  assert.deepEqual(session.contrasts, ['A_vs_B', 'C_vs_B'])
  assert.equal(session.contrast, 'A_vs_B')
  assert.equal(session.fdrThreshold, 0.25)
  assert.equal(session.hasCategories, true)
  assert.equal(new Session(catalog(), null).hasCategories, false)
})

test('protein rows carry the selected contrast statistics', () => {
  const session = new Session(catalog(), null)
  session.setContrast('C_vs_B')
  const [mapk1, tpr] = session.proteinRows()
  assert.equal(mapk1.sig_count, 1)
  assert.equal(mapk1.max_log2fc, 0.3)
  assert.equal(tpr.sig_count, 0)
  assert.equal(tpr.max_log2fc, null)
  session.setContrast('')
  assert.equal(session.proteinRows()[0].sig_count, 2)
})

test('category rows follow the member mode and key by source and term', () => {
  const session = new Session(catalog(), categories())
  const [row] = session.categoryRows()
  assert.equal(row.key, 'KinaseLib:CDK1')
  assert.equal(row.sites_catalog, 1)
  assert.equal(row.sites_total, 4)
  session.setMemberMode('members')
  assert.equal(session.categoryRows()[0].sites_catalog, 2)
  session.setContrast('C_vs_B')
  assert.deepEqual(session.categoryRows(), [])
})

test('selecting a term filters proteins and sites and switches to category color', () => {
  const session = new Session(catalog(), categories())
  session.setProtein(payload())
  session.selectTerm(session.categoryRows()[0])
  assert.equal(session.colorBy, 'category')
  assert.equal(session.proteinVisible({ uniprot_acc: 'P28482' }), true)
  assert.equal(session.proteinVisible({ uniprot_acc: 'P12270' }), false)
  const [s2, t3, y4] = session.ptms
  assert.equal(session.siteVisible(s2), true, 'member window matches case-insensitively')
  assert.equal(session.siteVisible(t3), false, 'leading edge excludes the second window')
  assert.equal(session.siteVisible(y4), false, 'other contrast is out of scope')
  session.setMemberMode('members')
  assert.equal(session.siteVisible(t3), true)
  session.clearTerm()
  assert.equal(session.colorBy, 'log2fc')
  assert.equal(session.siteVisible(t3), true)
})

test('rows draw the visible sites, or all in-scope sites marked when a term is selected', () => {
  const session = new Session(catalog(), categories())
  session.setProtein(payload())
  const visible = session.ptms.filter((p) => session.siteVisible(p))
  let rows = session.rows(visible)
  assert.deepEqual(rows.map((r) => r.contrast), ['A_vs_B'])
  assert.equal(rows[0].ptms.length, 2)
  assert.equal(rows[0].ptms[0].dim, false)
  assert.match(rows[0].ptms[0].color, /^#ff/)

  session.selectTerm(session.categoryRows()[0])
  rows = session.rows(visible.filter((p) => session.siteVisible(p)))
  assert.equal(rows[0].ptms.length, 2, 'context sites stay drawn')
  const [member, context] = rows[0].ptms
  assert.equal(member.color, CATEGORY_COLOR)
  assert.equal(context.color, CONTEXT_COLOR)
  assert.equal(context.dim, true)

  session.setContrast('')
  session.clearTerm()
  rows = session.rows(session.ptms)
  assert.deepEqual(rows.map((r) => r.contrast), ['A_vs_B', 'C_vs_B'])
})

test('crowded panels drop labels unless a term is selected', () => {
  const session = new Session(catalog(), null)
  const many = payload()
  many.ptms = Array.from({ length: LABEL_LIMIT + 1 }, (_, i) => ({
    res_num: i + 1, mod_aa: 'S', log2fc: 1, fdr: 0.5, contrast: 'A_vs_B', seq_window: 'X', plddt: 50
  }))
  session.setProtein(many)
  const [row] = session.rows(session.ptms)
  assert.ok(row.ptms.every((p) => p.nolabel))
})

test('protein label, highlight and status lines', () => {
  const session = new Session(catalog(), null)
  assert.equal(session.proteinLabel, '')
  session.setProtein(payload())
  assert.equal(session.proteinLabel, 'MAPK1 (P28482) | 360 AAs')
  const [s2] = session.ptms
  session.highlight(s2)
  assert.deepEqual(session.highlighted, { contrast: 'A_vs_B', resNum: 2 })
  assert.equal(session.siteStatus(s2), 'S2 @ A_vs_B | log2FC +1.50 | FDR 0.010 | pLDDT 88.0')
  session.highlight(null)
  assert.equal(session.highlighted, null)
  const term = new Session(catalog(), categories()).categoryRows()[0]
  assert.equal(new Session(catalog(), categories()).termStatus(term), 'CDK1 (KinaseLib) | NES +1.90 | FDR 0.001 | 1/4 member sites in catalog')
})
