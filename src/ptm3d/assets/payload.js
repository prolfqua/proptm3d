// Fetching and decoding the pipeline's data files.
//
// The pipeline writes either .json or .cbor (a PayloadWriter decides on the Python
// side); the extension is the contract, so the decoder is picked from the URL. The
// catalog's format is not known up front and is discovered by probing.

import { decode } from './vendor/cbor.js'

/**
 * Fetch and decode one payload file (.json or .cbor).
 *
 * @param {string} url Payload URL, relative to the served output root.
 * @returns {Promise<object>} The decoded payload.
 */
export async function loadPayload (url) {
  const response = await fetch(url, { cache: 'no-cache' })
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`)
  }
  if (url.endsWith('.cbor')) {
    return decode(new Uint8Array(await response.arrayBuffer()))
  }
  return response.json()
}

/**
 * Fetch one file as text (used for PDB structures).
 *
 * @param {string} url File URL, relative to the served output root.
 * @returns {Promise<string>} The file content.
 */
export async function loadText (url) {
  const response = await fetch(url, { cache: 'no-cache' })
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`)
  }
  return response.text()
}

/**
 * Locate and decode the run catalog, whichever format the pipeline wrote.
 *
 * @param {string} dataRoot Directory holding the data files.
 * @returns {Promise<object>} The decoded catalog ({proteins: [...]}).
 */
export async function loadCatalog (dataRoot = 'data') {
  for (const name of ['catalog.cbor', 'catalog.json']) {
    const response = await fetch(`${dataRoot}/${name}`, { cache: 'no-cache' })
    if (response.ok) {
      if (name.endsWith('.cbor')) {
        return decode(new Uint8Array(await response.arrayBuffer()))
      }
      return response.json()
    }
  }
  throw new Error(`No catalog found under ${dataRoot}/ - run the ptm3d pipeline first.`)
}
