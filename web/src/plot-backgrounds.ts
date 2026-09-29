import type { PlotBackground } from './charts.js'
import { servedUrl } from './served-url.js'

export interface PlotBackgrounds {
  schema_version: '1'
  plots: Record<string, { volcano: PlotBackground; protein_site: PlotBackground }>
}

export async function loadPlotBackgrounds(baseUrl = document.baseURI): Promise<PlotBackgrounds> {
  const response = await fetch(servedUrl('data/plot_backgrounds.json', baseUrl), {
    mode: 'same-origin', redirect: 'error',
  })
  if (!response.ok) throw new Error(`Could not load plot backgrounds: HTTP ${response.status}`)
  const backgrounds = await response.json() as PlotBackgrounds
  if (backgrounds.schema_version !== '1') throw new Error('Unsupported plot background schema.')
  for (const plots of Object.values(backgrounds.plots)) {
    plots.volcano.file = servedUrl(plots.volcano.file, baseUrl).href
    plots.protein_site.file = servedUrl(plots.protein_site.file, baseUrl).href
  }
  return backgrounds
}
