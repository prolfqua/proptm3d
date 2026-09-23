import assert from 'node:assert/strict'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import { buildPaeFigure, loadPae, paeBlockSize, paeModelFor, parsePae, proteinPosition } from '../src/pae.js'
import type { StructureFile } from '../src/types.js'

function model(fragment: number, start: number, end: number | null, pae_url: string | null = `pae/F${fragment}.json.gz`): StructureFile {
  return { file: `AF-P1-F${fragment}-model_v6.cif.gz`, fragment, version: 6, start, end, url: 'structures/x', pae_url }
}

const document = [{ predicted_aligned_error: [[0, 4, 30], [5, 0, 28], [29, 27, 0]], max_predicted_aligned_error: 31.75 }]

test('PAE documents parse into a square matrix and reject non-square data', () => {
  const matrix = parsePae(document)
  assert.equal(matrix.size, 3)
  assert.equal(matrix.maxPae, 31.75)
  assert.equal(matrix.values[1 * 3 + 0], 5)
  assert.equal(parsePae(document[0]).size, 3)
  assert.throws(() => parsePae([{ predicted_aligned_error: [[0, 1], [2]] }]), /not square/)
  assert.throws(() => parsePae({}), /no predicted_aligned_error/)
})

test('heatmap axes use protein residue numbers for normal and fragmented models', () => {
  const matrix = parsePae(document)
  const normal = buildPaeFigure(matrix, model(1, 1, 3), 2, 'P1')
  assert.deepEqual(normal.data[0].x, [1, 2, 3])
  assert.deepEqual(normal.data[0].z, [[0, 4, 30], [5, 0, 28], [29, 27, 0]])
  assert.deepEqual((normal.layout.shapes as Array<{ x0?: number; y0?: number }>).map((shape) => [shape.x0, shape.y0]),
    [[2, 1], [1, 2]])

  const fragment = buildPaeFigure(matrix, model(2, 1401, 1403), 1402, 'P1')
  assert.equal(proteinPosition(model(2, 1401, 1403), 1), 1401)
  assert.deepEqual(fragment.data[0].y, [1401, 1402, 1403])
  assert.equal((fragment.layout.shapes as unknown[]).length, 2)
  assert.deepEqual(buildPaeFigure(matrix, model(2, 1401, 1403), 20, 'P1').layout.shapes, [])
  assert.match(String((fragment.layout.title as { text: string }).text), /P1 · PAE · fragment 2/)
})

test('large matrices are shown as block means', () => {
  const binned = buildPaeFigure(parsePae(document), model(1, 1, 3), null, 'P1', 2)
  assert.deepEqual(binned.data[0].x, [1, 3])
  assert.deepEqual(binned.data[0].z, [[9 / 4, 29], [28, 0]])
  assert.equal(paeBlockSize(1125), 2)
  assert.equal(paeBlockSize(900), 1)
})

test('the PAE model follows the fragment displayed in 3D', () => {
  const models = [model(1, 1, 1400), model(2, 1201, 2600)]
  assert.equal(paeModelFor(models, 2)?.fragment, 2)
  assert.equal(paeModelFor(models, null)?.fragment, 1)
  assert.equal(paeModelFor([], 1), null)
})

test('PAE loads lazily once per model and reports missing files', async () => {
  const originalFetch = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.mode, 'same-origin')
    const url = new URL(input.toString())
    requests.push(url.pathname)
    if (url.pathname.endsWith('missing.json.gz')) return new Response('', { status: 404 })
    return new Response(gzipSync(JSON.stringify(document)))
  }) as typeof fetch
  try {
    const base = 'https://fixture.proptm3d.test/DPA/'
    assert.deepEqual(requests, [])
    const [first, second] = await Promise.all([loadPae('pae/F1.json.gz', base), loadPae('pae/F1.json.gz', base)])
    assert.equal(first, second)
    assert.equal(first.size, 3)
    assert.equal((await loadPae('pae/F2.json.gz', base)).values[2], 30)
    await assert.rejects(loadPae('pae/missing.json.gz', base), /PAE request failed \(404\)/)
    assert.deepEqual(requests, ['/DPA/pae/F1.json.gz', '/DPA/pae/F2.json.gz', '/DPA/pae/missing.json.gz'])
    await assert.rejects(loadPae('https://alphafold.ebi.ac.uk/files/x.json', base), /outside the served app/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
