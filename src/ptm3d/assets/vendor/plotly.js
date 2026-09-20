// The chart renderer, pinned in one place (same stack as rawDIAGQC).
//
// The full minified distribution, 4.3 MB uncompressed, fetched once and
// browser-cached. Plotly appends its own rules to document.head, which is one
// more reason the app renders into the light DOM.
export { default as Plotly } from 'https://cdn.jsdelivr.net/npm/plotly.js-dist-min@4.0.0/+esm'
