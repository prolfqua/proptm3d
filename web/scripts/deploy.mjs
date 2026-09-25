import { copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const distRoot = resolve(webRoot, 'dist')
const [folder, ...methods] = process.argv.slice(2)
if (!folder) throw new Error('Usage: npm run deploy -- FOLDER [DPA|DPU|CF-DPU ...]')
const outputRoot = resolve(process.env.INIT_CWD ?? process.cwd(), folder)
const knownMethods = new Set(['DPA', 'DPU', 'CF-DPU'])

await stat(resolve(distRoot, 'index.html'))
const selected = methods.length ? methods : (await readdir(outputRoot)).filter(method => knownMethods.has(method))
if (selected.length === 0) throw new Error(`No prepared methods in ${outputRoot}`)
const prepared = []
for (const method of selected) {
  if (!knownMethods.has(method)) throw new Error(`Unknown method: ${method}`)
  const target = resolve(outputRoot, method)
  const manifest = JSON.parse(await readFile(resolve(target, 'data', 'run.json'), 'utf8'))
  if (manifest.kind !== 'proptm3d-prepared-method' || manifest.method !== method) {
    throw new Error(`Refusing to deploy into an unprepared ${method} directory`)
  }
  prepared.push({ method, target })
}

const currentAssets = new Set(await readdir(resolve(distRoot, 'assets')))
const generatedAsset = /^[A-Za-z0-9._-]+-[A-Za-z0-9_-]+\.(?:js|css)$/
for (const { method, target } of prepared) {
  await mkdir(resolve(target, 'assets'), { recursive: true })
  await cp(resolve(distRoot, 'assets'), resolve(target, 'assets'), { recursive: true })
  for (const entry of await readdir(resolve(target, 'assets'), { withFileTypes: true })) {
    if (entry.isFile() && generatedAsset.test(entry.name) && !currentAssets.has(entry.name)) {
      await rm(resolve(target, 'assets', entry.name))
    }
  }
  await copyFile(resolve(distRoot, 'index.html'), resolve(target, 'index.html'))
  await copyFile(resolve(distRoot, 'favicon.svg'), resolve(target, 'favicon.svg'))
  await writeFile(resolve(target, 'data', 'browser-assets.json'),
    `${JSON.stringify({ schema_version: '1', files: [...currentAssets].sort().map(name => `assets/${name}`) }, null, 2)}\n`)
  process.stdout.write(`Installed browser app into ${target}\n`)
}
