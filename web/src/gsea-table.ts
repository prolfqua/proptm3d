import { trackTable } from './table-data.js'
import { TabulatorFull, type ColumnDefinition } from 'tabulator-tables'

import { sequenceSetKey, type GseaSiteTableRow } from './gsea.js'
import type {
  GseaSequenceSet,
} from './types.js'

export type GseaTableRow = GseaSequenceSet & { row_key: string }
function numberLabel(value: number | null, digits = 3): string {
  return value !== null && Number.isFinite(value) ? value.toFixed(digits) : '—'
}

export function gseaTableRows(rows: GseaSequenceSet[]): GseaTableRow[] {
  return rows.map((row) => ({ ...row, row_key: sequenceSetKey(row.source, row.sequence_set) }))
}

export function createGseaTable(
  host: HTMLElement,
  rows: GseaTableRow[],
  select: (key: string) => void,
): TabulatorFull {
  const columns: ColumnDefinition[] = [
    { title: 'Sequence set', field: 'sequence_set', frozen: true, minWidth: 150 },
    { title: 'Description', field: 'description', minWidth: 180, tooltip: true },
    { title: 'Source', field: 'source', minWidth: 105 },
    { title: 'NES', field: 'nes', sorter: 'number', hozAlign: 'right', width: 78,
      formatter: (cell) => numberLabel(cell.getValue() as number) },
    { title: 'FDR', field: 'fdr', sorter: 'number', hozAlign: 'right', width: 78,
      formatter: (cell) => numberLabel(cell.getValue() as number, 4) },
    { title: 'Mapped', field: 'genes_mapped', sorter: 'number', hozAlign: 'right', width: 82 },
    { title: 'Set size', field: 'genes_in_set', sorter: 'number', hozAlign: 'right', width: 82 },
  ]
  const table = new TabulatorFull(host, {
    data: rows,
    columns,
    columnDefaults: { headerWordWrap: true, headerTooltip: true },
    index: 'row_key',
    layout: 'fitDataStretch',
    initialSort: [{ column: 'fdr', dir: 'asc' }, { column: 'nes', dir: 'desc' }],
    placeholder: 'No sequence sets pass the GSEA FDR cutoff.',
  })
  table.on('rowClick', (_event, row) => select((row.getData() as GseaTableRow).row_key))
  return trackTable(table)
}

export function createGseaSiteTable(
  host: HTMLElement,
  rows: GseaSiteTableRow[],
  open: (row: GseaSiteTableRow) => void,
): TabulatorFull {
  const columns: ColumnDefinition[] = [
    { title: 'Gene', field: 'gene_name', frozen: true, minWidth: 105 },
    { title: 'Accession', field: 'accession', minWidth: 110 },
    { title: 'Site', field: 'site', minWidth: 170, tooltip: true },
    { title: 'log2FC', field: 'effect', sorter: 'number', hozAlign: 'right', width: 90,
      formatter: cell => numberLabel(cell.getValue() as number | null) },
    { title: 'Site FDR', field: 'fdr', sorter: 'number', hozAlign: 'right', width: 90,
      formatter: cell => numberLabel(cell.getValue() as number | null, 4) },
    { title: 'Rank', field: 'rank', sorter: 'number', hozAlign: 'right', width: 75,
      formatter: cell => numberLabel(cell.getValue() as number | null, 0),
      headerTooltip: 'Original position of the sequence window in the ranked GSEA input' },
    { title: 'Running ES', field: 'running_score', sorter: 'number', hozAlign: 'right', width: 105,
      formatter: (cell) => numberLabel(cell.getValue() as number),
      headerTooltip: 'Running enrichment score at this sequence-window hit' },
    { title: 'Set NES', field: 'nes', sorter: 'number', hozAlign: 'right', width: 85,
      formatter: (cell) => numberLabel(cell.getValue() as number),
      headerTooltip: 'Normalized enrichment score of the selected sequence set' },
    { title: 'Leading edge', field: 'is_leading_edge', hozAlign: 'center', width: 105,
      formatter: cell => cell.getValue() === null ? '—' : cell.getValue() ? 'Yes' : 'No' },
    { title: 'Sequence window', field: 'sequence_window', minWidth: 170, tooltip: true },
    { title: 'Protein ID', field: 'protein_Id', minWidth: 125 },
  ]
  const table = new TabulatorFull(host, {
    data: rows,
    columns,
    columnDefaults: { headerWordWrap: true, headerTooltip: true },
    index: 'row_key',
    layout: 'fitDataStretch',
    initialSort: [{ column: 'rank', dir: 'asc' }],
    placeholder: 'No sites match C and the protein search.',
    selectableRows: true,
  })
  table.on('rowClick', (_event, row) => open(row.getData() as GseaSiteTableRow))
  return trackTable(table)
}
