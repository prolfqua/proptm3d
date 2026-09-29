import { TabulatorFull, type ColumnDefinition } from 'tabulator-tables'

import { sequenceSetKey } from './gsea.js'
import type { GseaSequenceSet } from './types.js'

export type GseaTableRow = GseaSequenceSet & { row_key: string }

function numberLabel(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—'
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
  return table
}
