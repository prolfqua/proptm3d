import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matchingOptions } from '../src/searchable-select.js'

const options=[
  {value:'PSP\u0000CDK1',label:'KINASE-PSP_CDK1 · PTM-SEA'},
  {value:'PSP\u0000CDK2',label:'KINASE-PSP_CDK2 · PTM-SEA'},
  {value:'PATH\u0000WNT',label:'PATH-NP_WNT · PTM-SEA'},
]

test('an empty query lists every option in its given order', () => {
  assert.deepEqual(matchingOptions(options,'  '),options)
})

test('the query matches any part of the label, ignoring case', () => {
  assert.deepEqual(matchingOptions(options,'cdk').map(option=>option.value),['PSP\u0000CDK1','PSP\u0000CDK2'])
  assert.deepEqual(matchingOptions(options,'np_w').map(option=>option.value),['PATH\u0000WNT'])
  assert.deepEqual(matchingOptions(options,'absent'),[])
})
