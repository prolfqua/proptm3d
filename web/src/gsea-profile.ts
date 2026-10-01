import { html } from 'lit'
import type { BrowserProfile } from './browser-profile.js'
import { renderGseaControls, renderGseaFindPanel, renderGseaNavigation } from './gsea-view.js'

/** Enrichment profile adds B and the GSEA workspace to the common browser. */
export const gseaProfile: BrowserProfile = {
  id:'gsea', branches:['b','a','c'], contrastLabel:'Contrast for plots, detail and GSEA',
  navigationHint:'A limits the contrast choices. With B active, changing contrast reloads B; sequence-set focus and protein search only navigate.',
  filterNotice:'A limits B’s GSEA contrast choices; their site selections combine in C. C All is inclusive union. Bar clicks select sites and focus the UpSet display; View All changes only the plot.',
  guideUpSet:'A compares significant sites across contrasts and limits B’s GSEA contrast choices. B loads one contrast and compares its eligible sequence sets. Set-size bars select whole sets and columns select exact intersections. C defaults to their union with enabled Estimate and structural filters; an enabled Estimate uses the upper contrast. Off disables a filter; All includes its union. Show all sites suspends filtering. In A and B, Dots per intersection limits displayed columns only; whole-set bars still include shared sites. In B, Find sequence set brings matching rows and their intersections into view without changing filter membership.',
  enrichment:{
    renderNavigation:renderGseaNavigation, renderFilterControls:renderGseaControls,
    renderFindTab:(showFind)=>html`<button id="gsea-find-tab" type="button" data-find="gsea" aria-selected="false" hidden @click=${showFind}>GSEA</button>`,
    renderFindPanel:renderGseaFindPanel,
    createController:async(root,scopeChanged,findSets,setStatus,openSite)=>{
      const {GseaController}=await import('./gsea-controller.js')
      return new GseaController(root,scopeChanged,findSets,setStatus,openSite)
    },
  },
}
