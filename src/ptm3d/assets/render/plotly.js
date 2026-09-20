// The chart backend for the N-to-C pane.
//
// `Plotly.react` serves the first and every later render: given the same host
// it diffs against what is there. Sizing is manual: the pane's height changes
// with the row count, and the host may be hidden behind a collapsed layout.

import { Plotly } from '../vendor/plotly.js'

const CONFIG = {
  displaylogo: false,
  responsive: false,
  modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
  toImageButtonOptions: { format: 'svg' }
}

/**
 * Render a figure into a host element.
 *
 * @param {HTMLElement} host The Plotly host.
 * @param {{data: object[], layout: object}} figure The figure to draw.
 * @param {object} options Render options.
 * @param {number} options.height Figure height in CSS pixels.
 * @param {(index: number) => void} [options.onClick] Called with the clicked
 *   point's customdata, when the trace carries one.
 * @returns {Promise<void>} Resolves when Plotly has drawn.
 */
export async function renderFigure (host, figure, { height, onClick }) {
  await Plotly.react(host, figure.data, { ...figure.layout, height, autosize: true }, CONFIG)
  host.removeAllListeners('plotly_click')
  if (onClick) {
    host.on('plotly_click', (event) => {
      const point = event.points.find((p) => p.customdata !== undefined)
      if (point) onClick(point.customdata)
    })
  }
}

/**
 * Re-measure a drawn figure after its host changed size.
 *
 * @param {HTMLElement} host The Plotly host.
 */
export function resizeFigure (host) {
  if (host.data) Plotly.Plots.resize(host)
}

/**
 * Remove a figure and its listeners.
 *
 * @param {HTMLElement} host The Plotly host.
 */
export function clearFigure (host) {
  if (host.data) Plotly.purge(host)
}
