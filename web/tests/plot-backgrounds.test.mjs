import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inflateSync } from 'node:zlib'
import { renderPlotBackground } from '../scripts/plot-backgrounds.mjs'

function readPixels(png) {
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  let offset = 8
  let width = 0
  let height = 0
  const compressed = []
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    if (type === 'IHDR') {
      width = png.readUInt32BE(offset + 8)
      height = png.readUInt32BE(offset + 12)
      assert.equal(png[offset + 17], 6) // RGBA
    }
    if (type === 'IDAT') compressed.push(png.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }
  return { width, height, pixels: inflateSync(Buffer.concat(compressed)) }
}

function pixel(image, x, y) {
  const start = y * (1 + image.width * 4) + 1 + x * 4
  return [...image.pixels.subarray(start, start + 4)]
}

test('precomputed black points are transparent elsewhere and vertically match data coordinates', () => {
  const { png, x_range: xRange, y_range: yRange } = renderPlotBackground(
    [[0, 0], [4, 5]], { width: 51, height: 31 },
  )
  assert.ok(xRange[0] < 0 && xRange[1] > 4)
  assert.ok(yRange[0] < 0 && yRange[1] > 5)
  const image = readPixels(png)
  assert.equal(image.width, 51)
  assert.equal(image.height, 31)
  assert.deepEqual(pixel(image, 25, 15), [0, 0, 0, 0])
  assert.deepEqual(pixel(image, 2, 29).slice(0, 3), [0, 0, 0])
  assert.ok(pixel(image, 2, 29)[3] > 0)
  assert.ok(pixel(image, 48, 1)[3] > 0)
  assert.equal(pixel(image, 48, 29)[3], 0)
})

test('a missing plottable series is rejected rather than creating misleading axes', () => {
  assert.throws(() => renderPlotBackground([]), /without plottable points/)
})
