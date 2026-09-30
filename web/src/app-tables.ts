import { trackTable } from './table-data.js'
import { TabulatorFull, type ColumnDefinition } from 'tabulator-tables'

import type { DetailRow } from './detail.js'
import { exposureLabel, plddtLabel, regionLabel, structureDetail } from './structural.js'
import type { ProteinSummary } from './summary.js'
import type { ProteinCatalogRow, SiteStructure } from './types.js'

export type FindRow = ProteinSummary & {
  matching_sites: string[]
  matching_site_labels: string[]
}

interface FindTableActions {
  open: (row: FindRow) => void
  hover: (proteinId: string | null) => void
  count: (visible: number) => void
}

interface SiteTableActions {
  click: (site: string) => void
  built: () => void
  enter?: (site: string) => void
  leave?: () => void
}

function numberLabel(value: number | null, digits = 3): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(digits)
}

function structureCell(structure: SiteStructure, label: string): string {
  const span = document.createElement('span')
  span.textContent = label
  span.title = structureDetail(structure)
  return span.outerHTML
}

function siteColumns(): ColumnDefinition[] {
  return [
    { title: 'Site', field: 'site', frozen: true, width: 165, tooltip: true },
    { title: 'Pos.', field: 'posInProtein', sorter: 'number', hozAlign: 'right', width: 55 },
    { title: 'AA', field: 'modAA', width: 45 },
    { title: 'log2FC', field: 'effect', sorter: 'number', hozAlign: 'right', width: 77,
      formatter: (cell) => numberLabel(cell.getValue() as number | null) },
    { title: 'FDR', field: 'fdr', sorter: 'number', hozAlign: 'right', width: 70,
      formatter: (cell) => numberLabel(cell.getValue() as number | null, 4) },
    { title: 'Pass', field: 'passes_cutoff', width: 58, hozAlign: 'center', formatter: 'tickCross',
      headerTooltip: 'Passes the shared FDR and |log2FC| thresholds' },
    { title: 'Measured', field: 'has_measurement', width: 75, formatter: 'tickCross' },
    { title: 'Estimate', field: 'estimate_status', width: 115 },
    { title: 'Exposure', field: 'structure.exposure', width: 96,
      headerTooltip: 'Bludau prediction-aware exposure from AlphaFold coordinates and PAE; hover a cell for neighbor counts',
      formatter: (cell) => structureCell((cell.getData() as DetailRow).structure,
        exposureLabel((cell.getData() as DetailRow).structure)) },
    { title: 'Region', field: 'structure.region', width: 96,
      headerTooltip: 'Bludau prediction-aware intrinsically disordered region (IDR) or structured region',
      formatter: (cell) => structureCell((cell.getData() as DetailRow).structure,
        regionLabel((cell.getData() as DetailRow).structure)) },
    { title: 'pLDDT', field: 'structure.plddt', width: 62, hozAlign: 'right', sorter: 'number',
      headerTooltip: 'AlphaFold per-residue model confidence at the site; informational, not a filter',
      formatter: (cell) => plddtLabel((cell.getData() as DetailRow).structure) },
  ]
}

export function createFindTable(
  host: HTMLElement,
  rows: FindRow[],
  actions: FindTableActions,
): TabulatorFull {
  const columns: ColumnDefinition[] = [
    { title: 'Gene', field: 'gene_name', frozen: true, minWidth: 105 },
    { title: 'Accession', field: 'accession', minWidth: 110 },
    { title: 'Matching sites', field: 'matching_site_labels', minWidth: 180,
      formatter: (cell) => (cell.getValue() as string[]).join(', '), tooltip: true },
    { title: 'Measured sites', field: 'measured_sites', hozAlign: 'right', sorter: 'number', minWidth: 115 },
    { title: 'Tested sites', field: 'tested_sites', hozAlign: 'right', sorter: 'number', minWidth: 105 },
    { title: 'Significant sites', field: 'significant_sites', hozAlign: 'right', sorter: 'number', minWidth: 125 },
    { title: 'Up pairs', field: 'up_pairs', hozAlign: 'right', sorter: 'number', minWidth: 95,
      tooltip: 'Significant site–contrast pairs with positive effect' },
    { title: 'Down pairs', field: 'down_pairs', hozAlign: 'right', sorter: 'number', minWidth: 105,
      tooltip: 'Significant site–contrast pairs with negative effect' },
    { title: 'Largest |log2FC|', field: 'largest_effect', hozAlign: 'right', sorter: 'number', minWidth: 135,
      formatter: (cell) => numberLabel(cell.getValue() as number | null) },
    { title: 'Protein ID', field: 'protein_Id', minWidth: 125 },
  ]
  const table = new TabulatorFull(host, {
    data: rows, columns, columnDefaults: { headerWordWrap: true, headerTooltip: true },
    index: 'protein_Id', layout: 'fitColumns',
    initialSort: [{ column: 'significant_sites', dir: 'desc' }],
    placeholder: 'No proteins match the current search.',
  })
  table.on('rowClick', (_event, row) => actions.open(row.getData() as FindRow))
  table.on('rowMouseEnter', (_event, row) =>
    actions.hover((row.getData() as ProteinCatalogRow).protein_Id))
  table.on('rowMouseLeave', () => actions.hover(null))
  table.on('dataFiltered', (_filters, visible) => actions.count(visible.length))
  return trackTable(table)
}

export function createSiteTable(
  host: HTMLElement,
  rows: DetailRow[],
  index: 'row_id' | 'site',
  actions: SiteTableActions,
): TabulatorFull {
  const table = new TabulatorFull(host, {
    data: rows, columns: siteColumns(), columnDefaults: { headerWordWrap: true, headerTooltip: true },
    index, layout: 'fitDataStretch', initialSort: [{ column: 'posInProtein', dir: 'asc' }],
    placeholder: 'No sites match the current filters.',
  })
  table.on('rowClick', (_event, row) => actions.click((row.getData() as DetailRow).site))
  if (actions.enter) {
    table.on('rowMouseEnter', (_event, row) => actions.enter!((row.getData() as DetailRow).site))
  }
  if (actions.leave) table.on('rowMouseLeave', actions.leave)
  table.on('tableBuilt', actions.built)
  return trackTable(table)
}
