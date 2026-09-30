import type { TabulatorFull } from 'tabulator-tables'

const ready = new WeakMap<TabulatorFull, Promise<void>>()

/** Register at construction: upstream filters can publish before Tabulator builds its DOM. */
export function trackTable(table: TabulatorFull): TabulatorFull {
  ready.set(table, new Promise(resolve => table.on('tableBuilt', resolve)))
  return table
}

export async function replaceTableRows(table: TabulatorFull, rows: object[]): Promise<void> {
  await ready.get(table)
  await table.replaceData(rows)
}
