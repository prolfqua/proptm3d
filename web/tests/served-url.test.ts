import assert from 'node:assert/strict'
import test from 'node:test'
import { servedUrl } from '../src/served-url.js'

const base = 'https://fixture.proptm3d.test/DPA/'

test('prepared files resolve on the app origin', () => {
  assert.equal(servedUrl('tables/sites.parquet', base).href, `${base}tables/sites.parquet`)
  assert.equal(servedUrl(`${base}structures/model.cif.gz`, base).href,
    `${base}structures/model.cif.gz`)
  assert.equal(servedUrl('../shared/structures/model.cif.gz', base).href,
    'https://fixture.proptm3d.test/shared/structures/model.cif.gz')
  assert.equal(servedUrl('shared/pae/model.json.gz', 'https://fixture.proptm3d.test/').href,
    'https://fixture.proptm3d.test/shared/pae/model.json.gz')
})

test('prepared files cannot resolve to another origin or protocol', () => {
  for (const path of [
    'https://www.uniprot.org/uniprotkb/P12345',
    '//www.uniprot.org/uniprotkb/P12345',
    'data:text/plain,model',
    'file:///tmp/model.cif.gz',
  ]) {
    assert.throws(() => servedUrl(path, base), /Refusing to load a URL outside the served app/)
  }
})
