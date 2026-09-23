import { copyFile, cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatePlotBackgrounds } from './plot-backgrounds.mjs'

const webRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const distRoot = resolve(webRoot, 'dist')
const outputRoot = resolve(webRoot, '..', 'output_3d')
const methods = process.argv.slice(2)
const selected = methods.length ? methods : ['DPA', 'DPU', 'CF-DPU']
const knownMethods = new Set(['DPA', 'DPU', 'CF-DPU'])

await stat(resolve(distRoot, 'index.html'))
const prepared = []
for (const method of selected) {
  if (!knownMethods.has(method)) throw new Error(`Unknown method: ${method}`)
  const target = resolve(outputRoot, method)
  const manifest = JSON.parse(await readFile(resolve(target, 'data', 'run.json'), 'utf8'))
  if (manifest.kind !== 'proptm3d-prepared-method' || manifest.method !== method) {
    throw new Error(`Refusing to deploy into an unprepared ${method} directory`)
  }
  prepared.push({ method, target, manifest })
}

const currentAssets = new Set(await readdir(resolve(distRoot, 'assets')))
const generatedAsset = /^(?:index|src|structure|plotly\.min|plotly-gl2d\.min|plotly-cartesian\.min)-[A-Za-z0-9_-]+\.(?:js|css)$/
for (const { method, target, manifest } of prepared) {
  await generatePlotBackgrounds(target, manifest)
  await mkdir(resolve(target, 'assets'), { recursive: true })
  await cp(resolve(distRoot, 'assets'), resolve(target, 'assets'), { recursive: true })
  for (const entry of await readdir(resolve(target, 'assets'), { withFileTypes: true })) {
    if (entry.isFile() && generatedAsset.test(entry.name) && !currentAssets.has(entry.name)) {
      await rm(resolve(target, 'assets', entry.name))
    }
  }
  await copyFile(resolve(distRoot, 'index.html'), resolve(target, 'index.html'))
  await copyFile(resolve(distRoot, 'favicon.svg'), resolve(target, 'favicon.svg'))
  process.stdout.write(`Installed browser app into ${target}\n`)
}
