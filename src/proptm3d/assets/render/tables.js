// The Tabulator tables: column definitions and construction.
//
// TabulatorFull carries every module; header filters, sorters and formatters
// work without registration. Tables render into the light DOM because
// Tabulator's stylesheet does not cross a shadow boundary.

import { foldChangeColor } from '../lib/color.js'
import { canonicalWindow, fdrText } from '../lib/session.js'
import { TabulatorFull } from '../vendor/tabulator.js'

const fcBadge = (value) => {
  if (value === null || value === undefined) return '-'
  const color = foldChangeColor(value)
  return `<span style="background:${color};color:#000;padding:1px 5px;border-radius:4px;font-weight:600;">${value > 0 ? '+' : ''}${value.toFixed(2)}</span>`
}

const PROTEIN_COLUMNS = [
  { title: 'Gene', field: 'gene_name', headerFilter: 'input' },
  { title: 'Accession', field: 'uniprot_acc', headerFilter: 'input' },
  { title: 'Sites', field: 'ptm_count', hozAlign: 'right', sorter: 'number', width: 70 },
  {
    title: 'Sig.',
    field: 'sig_count',
    hozAlign: 'right',
    sorter: 'number',
    width: 64,
    headerFilter: 'number',
    headerFilterPlaceholder: '>= ...',
    headerFilterFunc: '>=',
    headerTooltip: 'Significant sites in the selected contrast (all contrasts when none is selected)'
  },
  {
    title: 'Max FC',
    field: 'max_log2fc',
    hozAlign: 'right',
    sorter: 'number',
    width: 90,
    headerFilter: 'number',
    headerFilterPlaceholder: '>= |x|',
    headerFilterFunc: (headerValue, rowValue) => Math.abs(rowValue) >= Number(headerValue),
    headerTooltip: 'log2FC of the site with the largest absolute fold change in the selected contrast',
    formatter: (cell) => fcBadge(cell.getValue())
  }
]

const CATEGORY_COLUMNS = [
  { title: 'Term', field: 'term_id', headerFilter: 'input', minWidth: 110 },
  {
    title: 'Source',
    field: 'source',
    width: 96,
    headerFilter: 'list',
    headerFilterParams: { valuesLookup: true, clearable: true }
  },
  {
    title: 'NES',
    field: 'nes',
    hozAlign: 'right',
    sorter: 'number',
    width: 64,
    formatter: (cell) => {
      const value = cell.getValue()
      if (value === null || value === undefined) return '-'
      const color = value > 0 ? '#f87171' : '#4ade80'
      return `<span style="color:${color};font-weight:600;">${value > 0 ? '+' : ''}${value.toFixed(2)}</span>`
    }
  },
  {
    title: 'FDR',
    field: 'fdr',
    hozAlign: 'right',
    sorter: 'number',
    width: 76,
    headerFilter: 'number',
    headerFilterPlaceholder: '<= ...',
    headerFilterFunc: '<=',
    formatter: (cell) => fdrText(cell.getValue())
  },
  {
    title: 'Sites',
    field: 'sites_catalog',
    hozAlign: 'right',
    sorter: 'number',
    width: 74,
    headerTooltip:
      'Member sites in the processed proteins / member sites in the whole dataset, for the chosen member mode',
    formatter: (cell) => `${cell.getValue()}/${cell.getData().sites_total}`
  }
]

/**
 * Site table columns; the category count column reads the live window index.
 *
 * @param {() => Map<string, string[]>} windowTerms Supplier of the current index.
 * @returns {object[]} Tabulator column definitions.
 */
function siteColumns (windowTerms) {
  return [
    { title: 'Site', field: 'site', width: 64, headerFilter: 'input' },
    { title: 'Contrast', field: 'contrast', width: 110 },
    {
      title: 'log2FC',
      field: 'log2fc',
      hozAlign: 'right',
      sorter: 'number',
      width: 76,
      headerFilter: 'number',
      headerFilterPlaceholder: '>= |x|',
      headerFilterFunc: (headerValue, rowValue) => Math.abs(rowValue) >= Number(headerValue),
      headerTooltip: 'log2 fold change; the filter keeps sites with |log2FC| at or above the value',
      formatter: (cell) => fcBadge(cell.getValue())
    },
    {
      title: 'FDR',
      field: 'fdr',
      hozAlign: 'right',
      sorter: 'number',
      width: 70,
      headerFilter: 'number',
      headerFilterPlaceholder: '<= ...',
      headerFilterFunc: '<=',
      formatter: (cell) => fdrText(cell.getValue())
    },
    {
      title: 'Imp.',
      field: 'imputed',
      width: 46,
      hozAlign: 'center',
      headerTooltip: 'Estimate rests on a limit-of-detection imputation',
      formatter: (cell) => (cell.getValue() ? '&#9711;' : '')
    },
    {
      title: 'pLDDT',
      field: 'plddt',
      hozAlign: 'right',
      sorter: 'number',
      width: 62,
      headerTooltip:
        'AlphaFold per-residue model confidence (0-100, from the PDB B-factor column); below ~70 the region is likely flexible or intrinsically disordered',
      formatter: (cell) => (cell.getValue() === null ? '-' : cell.getValue().toFixed(0))
    },
    {
      title: 'Exp.',
      field: 'ppse',
      hozAlign: 'right',
      sorter: 'number',
      width: 54,
      headerTooltip:
        'Exposure: C-alpha neighbor count within 12 A of the site; low = surface-exposed, high = buried (simplified pPSE, after Bludau et al. 2022)',
      formatter: (cell) => (cell.getValue() === null ? '-' : cell.getValue().toFixed(0))
    },
    {
      title: 'Cat.',
      field: 'seq_window',
      width: 50,
      headerSort: false,
      headerTooltip: 'Number of categories this site belongs to in the current contrast and member mode',
      formatter: (cell) => {
        const terms = windowTerms().get(canonicalWindow(cell.getValue())) || []
        return terms.length ? String(terms.length) : ''
      },
      tooltip: (_event, cell) => (windowTerms().get(canonicalWindow(cell.getValue())) || []).join('\n')
    },
    { title: 'Sequence window', field: 'seq_window', minWidth: 90, headerFilter: 'input' }
  ]
}

const BASE = { data: [], layout: 'fitColumns', height: '100%', selectableRows: 1 }

/** @param {HTMLElement} host Where the table renders. */
export function categoriesTable (host) {
  return new TabulatorFull(host, {
    ...BASE,
    index: 'key',
    columns: CATEGORY_COLUMNS,
    initialSort: [{ column: 'fdr', dir: 'asc' }]
  })
}

/** @param {HTMLElement} host Where the table renders. */
export function proteinTable (host) {
  return new TabulatorFull(host, {
    ...BASE,
    index: 'uniprot_acc',
    columns: PROTEIN_COLUMNS,
    initialSort: [{ column: 'sig_count', dir: 'desc' }]
  })
}

/**
 * @param {HTMLElement} host Where the table renders.
 * @param {() => Map<string, string[]>} windowTerms Supplier of the current window index.
 */
export function siteTable (host, windowTerms) {
  return new TabulatorFull(host, {
    ...BASE,
    columns: siteColumns(windowTerms),
    initialSort: [{ column: 'fdr', dir: 'asc' }]
  })
}

/** Resolve once a table has built, so data and filters can be applied safely. */
export function tableReady (table) {
  return new Promise((resolve) => table.on('tableBuilt', resolve))
}
