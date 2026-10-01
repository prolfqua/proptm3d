import type { TemplateResult } from 'lit'
import type { GseaController } from './gsea-controller.js'
import type { GseaViewActions } from './gsea-view.js'
import type { FilterBranch } from './filtering.js'
import type { RunManifest } from './types.js'
import { statsProfile } from './stats-profile.js'
import { gseaProfile } from './gsea-profile.js'

export { statsProfile, gseaProfile }

/** Optional enrichment plugin contribution; Stats does not implement these hooks. */
export interface EnrichmentExtension {
  renderNavigation(actions: GseaViewActions): TemplateResult
  renderFilterControls(actions: GseaViewActions): TemplateResult
  renderFindTab(showFind: () => void): TemplateResult
  renderFindPanel(): TemplateResult
  createController(root: HTMLElement, scopeChanged: () => void,
    findSets: (matches: ReadonlySet<string> | null) => void,
    setStatus: (message: string, error?: boolean) => void,
    openSite: (proteinId: string, site: string, contrast: string) => void): Promise<GseaController | null>
}

/** Built-in browser profiles compose the same filtering model and common workspaces. */
export interface BrowserProfile {
  readonly id: 'stats' | 'gsea'
  readonly branches: readonly FilterBranch[]
  readonly contrastLabel: string
  readonly navigationHint: string
  readonly filterNotice: string
  readonly guideUpSet: string
  readonly enrichment?: EnrichmentExtension
}

export function profileFor(run: RunManifest): BrowserProfile {
  return run.gsea?.results.length ? gseaProfile : statsProfile
}
