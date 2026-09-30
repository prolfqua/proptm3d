import assert from 'node:assert/strict'
import test from 'node:test'
import type { TabulatorFull } from 'tabulator-tables'
import { trackTable, replaceTableRows } from '../src/table-data.js'

test('early filter publications wait for tableBuilt before replacing rows', async () => {
  let built!: () => void
  const published: object[][] = []
  const table = trackTable({
    on(event:string, callback:()=>void) { assert.equal(event,'tableBuilt'); built=callback },
    async replaceData(rows:object[]) { published.push(rows) },
  } as unknown as TabulatorFull)
  const first = replaceTableRows(table,[{site:'initial'}])
  const second = replaceTableRows(table,[{site:'loaded'}])
  await Promise.resolve()
  assert.equal(published.length,0)
  built()
  await Promise.all([first,second])
  assert.deepEqual(published,[[{site:'initial'}],[{site:'loaded'}]])
})
