// The log2FC color scale shared by both apps.

const LOG2FC_COLOR_SCALE = 2.5
const LOG2FC_COLOR_DAMPING = 0.8

/**
 * Map a log2FC value onto a green-white-red gradient.
 *
 * Matches the PyMOL exporter's convention: green = down, white = unchanged, red = up
 * (the classic differential-expression heatmap scale), which also keeps the site
 * spheres distinguishable from the blue/cyan pLDDT backbone coloring.
 *
 * @param {number} log2fc The log2 fold change.
 * @returns {string} A hex color.
 */
export function foldChangeColor (log2fc) {
  const intensity = Math.min(1, Math.abs(log2fc) / LOG2FC_COLOR_SCALE)
  const faded = Math.round(255 * (1 - intensity * LOG2FC_COLOR_DAMPING))
  const hex = (v) => v.toString(16).padStart(2, '0')
  return log2fc > 0 ? `#ff${hex(faded)}${hex(faded)}` : `#${hex(faded)}ff${hex(faded)}`
}
