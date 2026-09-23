import { readFile, readdir, mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'

const WIDTH = 1600
const HEIGHT = 640
const DOT_RADIUS = 2
const DOT_ALPHA = 92
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const label = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  label.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length)
  return chunk
}

function encodePng(pixels, width, height) {
  const scanlines = Buffer.alloc(height * (1 + width * 4))
  for (let row = 0; row < height; row += 1) {
    pixels.copy(scanlines, row * (1 + width * 4) + 1, row * width * 4, (row + 1) * width * 4)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // RGBA, 8 bits per channel
  header[9] = 6
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function paddedRange(values, includeZero = false) {
  if (values.length === 0) throw new Error('Cannot render a background without plottable points')
  let low = includeZero ? 0 : Infinity
  let high = includeZero ? 0 : -Infinity
  for (const value of values) {
    low = Math.min(low, value)
    high = Math.max(high, value)
  }
  const pad = Math.max((high - low) * 0.05, 0.1)
  return [low - pad, high + pad]
}

export function renderPlotBackground(points, { width = WIDTH, height = HEIGHT } = {}) {
  const xRange = paddedRange(points.map(([x]) => x), true)
  const yRange = paddedRange(points.map(([, y]) => y), true)
  const pixels = Buffer.alloc(width * height * 4)
  for (const [x, y] of points) {
    const centerX = Math.round(((x - xRange[0]) / (xRange[1] - xRange[0])) * (width - 1))
    const centerY = Math.round(((yRange[1] - y) / (yRange[1] - yRange[0])) * (height - 1))
    for (let dy = -DOT_RADIUS; dy <= DOT_RADIUS; dy += 1) {
      for (let dx = -DOT_RADIUS; dx <= DOT_RADIUS; dx += 1) {
        if (dx * dx + dy * dy > DOT_RADIUS * DOT_RADIUS) continue
        const pixelX = centerX + dx
        const pixelY = centerY + dy
        if (pixelX < 0 || pixelX >= width || pixelY < 0 || pixelY >= height) continue
        const alphaIndex = (pixelY * width + pixelX) * 4 + 3
        pixels[alphaIndex] += Math.round(DOT_ALPHA * (1 - pixels[alphaIndex] / 255))
      }
    }
  }
  return { png: encodePng(pixels, width, height), x_range: xRange, y_range: yRange }
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

export async function generatePlotBackgrounds(target, manifest) {
  const tablePath = manifest.files.site_stats_parquet
  if (tablePath !== 'tables/site_stats.parquet') {
    throw new Error(`Unexpected site-statistics table path: ${tablePath}`)
  }
  const bytes = await readFile(resolve(target, tablePath))
  const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const rows = await parquetReadObjects({ file, compressors })
  const backgroundDir = resolve(target, 'data', 'plot_backgrounds')
  await mkdir(backgroundDir, { recursive: true })
  const plots = {}
  const expectedFiles = new Set()

  for (const [index, contrast] of manifest.contrasts.entries()) {
    const scoped = rows.filter((row) => row.contrast === contrast)
    const volcanoPoints = scoped
      .filter((row) => finite(row.effect) && finite(row.fdr))
      .map((row) => [row.effect, -Math.log10(Math.max(row.fdr, 1e-300))])
    const proteinSitePoints = scoped
      .filter((row) => finite(row.protein_fc) && finite(row.original_site_fc))
      .map((row) => [row.protein_fc, row.original_site_fc])
    const volcano = renderPlotBackground(volcanoPoints)
    const proteinSite = renderPlotBackground(proteinSitePoints)
    const volcanoName = `volcano-${index}.png`
    const proteinSiteName = `protein-site-${index}.png`
    expectedFiles.add(volcanoName)
    expectedFiles.add(proteinSiteName)
    await Promise.all([
      writeFile(resolve(backgroundDir, volcanoName), volcano.png),
      writeFile(resolve(backgroundDir, proteinSiteName), proteinSite.png),
    ])
    plots[contrast] = {
      volcano: {
        file: `data/plot_backgrounds/${volcanoName}`,
        x_range: volcano.x_range,
        y_range: volcano.y_range,
      },
      protein_site: {
        file: `data/plot_backgrounds/${proteinSiteName}`,
        x_range: proteinSite.x_range,
        y_range: proteinSite.y_range,
      },
    }
  }

  for (const entry of await readdir(backgroundDir)) {
    if (/^(?:volcano|protein-site)-\d+\.png$/.test(entry) && !expectedFiles.has(entry)) {
      await rm(resolve(backgroundDir, entry))
    }
  }
  await writeFile(resolve(target, 'data', 'plot_backgrounds.json'),
    `${JSON.stringify({ schema_version: '1', plots }, null, 2)}\n`)
  return plots
}
