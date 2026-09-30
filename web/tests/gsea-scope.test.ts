import assert from 'node:assert/strict'
import { test } from 'node:test'
import { availableEnrichmentScopes, resolveEnrichmentContext } from '../src/gsea.js'
import { contrastsAllowedByA } from '../src/filtering.js'
import type { RunManifest } from '../src/types.js'

const files={sequence_sets_parquet:'sets',memberships_parquet:'members',curves_parquet:'curves'}
const run={contrasts:['early','late','interaction'],gsea:{results:[
  {id:'r1',label:'Result 1',contrasts:{early:files,late:files}},
  {id:'r2',label:'Result 2',contrasts:{late:files,interaction:files}},
]}} as unknown as RunManifest

test('B results and contrast choices are restricted to A-plausible contexts', () => {
  const allowed=contrastsAllowedByA(run.contrasts,{kind:'intersection',ids:['interaction','early']})
  assert.deepEqual(availableEnrichmentScopes(run,allowed).map(scope=>
    [scope.result.id,scope.contrasts]),[['r1',['early']],['r2',['interaction']]])
  assert.deepEqual(availableEnrichmentScopes(run,['absent']),[])
})

test('a single A contrast automatically chooses its compatible B result and payload context', () => {
  const allowed=contrastsAllowedByA(run.contrasts,{kind:'set',id:'early'})
  const context=resolveEnrichmentContext(run,allowed,'r2','interaction')
  assert.deepEqual(context.scopes.map(scope=>scope.result.id),['r1'])
  assert.deepEqual(context.contrasts,['early'])
  assert.equal(context.resultId,'r1')
  assert.equal(context.contrast,'early')
})

test('multiple A contrasts keep one compatible B context until the user switches it', () => {
  const allowed=contrastsAllowedByA(run.contrasts,{kind:'intersection',ids:['late','interaction']})
  const context=resolveEnrichmentContext(run,allowed,'r2','interaction')
  assert.deepEqual(context.contrasts,['late','interaction'])
  assert.equal(context.contrast,'interaction')
  assert.equal(resolveEnrichmentContext(run,allowed,'r2','late').contrast,'late')
  assert.equal(resolveEnrichmentContext(run,['early'],'r2','interaction').contrast,'early')
  assert.deepEqual(resolveEnrichmentContext(run,[],'r2','interaction').contrasts,[])
})
