// The CBOR decoder, pinned in one place (same stack as rawDIAGQC).
// The decode-only entry point, not the package root: smaller, and decoding is
// all the viewer does with CBOR.
export { decode } from 'https://cdn.jsdelivr.net/npm/cbor-x@1.6.6/decode/+esm'
