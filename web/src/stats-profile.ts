import type { BrowserProfile } from './browser-profile.js'

/** Statistics profile: only A and C, with no enrichment controller or GSEA DOM. */
export const statsProfile: BrowserProfile = {
  id:'stats', branches:['a','c'], contrastLabel:'Contrast for plots and detail',
  navigationHint:'A limits the available contrasts. Find protein only navigates results.',
  filterNotice:'A selects significant sites across contrasts. C combines A with Estimate, Exposure and Region. Bar clicks select sites; View All changes only the plot.',
  guideUpSet:'A compares significant sites across contrasts. C combines A with Estimate, Exposure and Region; an enabled Estimate uses the upper contrast. Set-size bars select whole sets and columns select exact intersections. Off disables A; All includes its union. Show all sites suspends filtering. Dots per intersection limits displayed A columns only; whole-set bars still include shared sites.',
}
