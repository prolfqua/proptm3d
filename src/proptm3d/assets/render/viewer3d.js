// 3Dmol.js rendering shared by both apps: backbone styles and PTM site marks.
//
// 3Dmol itself is loaded as a classic script ($3Dmol global) by each page.

/**
 * The cartoon style for a backbone color choice.
 *
 * @param {string} styleChoice 'plddt', 'spectrum', or 'slate'.
 * @returns {object} A 3Dmol style object.
 */
export function cartoonStyleFor (styleChoice) {
  if (styleChoice === 'spectrum') {
    return { cartoon: { color: 'spectrum', opacity: 0.75 } }
  }
  if (styleChoice === 'slate') {
    return { cartoon: { color: '#475569', opacity: 0.75 } }
  }
  // AlphaFold DB pLDDT confidence coloring (default).
  return {
    cartoon: {
      colorfunc: (atom) => {
        const p = atom.b
        if (p > 90) return '#1d4ed8' // Very High - Dark Blue
        if (p > 70) return '#38bdf8' // Confident - Cyan
        if (p > 50) return '#facc15' // Low - Yellow
        return '#f97316' //             Very Low / IDR - Orange
      },
      opacity: 0.75
    }
  }
}

/**
 * Render PTM sites as colored spheres with labels on the current model.
 *
 * The highlighted site (if any) gets a larger sphere and a bolder label so it can
 * be picked out without changing the zoom level. A record carrying `dim: true` is
 * drawn as unlabeled, translucent context (used while a category is selected: the
 * figure keeps every site visible and only marks the members).
 *
 * @param {object} viewer A 3Dmol viewer with one model loaded.
 * @param {Array<object>} ptms PTM records carrying res_num, color, and coordinates.
 * @param {string} styleChoice Backbone color choice for {@link cartoonStyleFor}.
 * @param {function(object): void} onSelect Called with the record when a site is clicked.
 * @param {number|null} highlightResNum Residue number to emphasize, or null.
 */
export function renderPtmSites (viewer, ptms, styleChoice, onSelect, highlightResNum = null) {
  viewer.removeAllShapes()
  viewer.removeAllLabels()
  viewer.setStyle({}, cartoonStyleFor(styleChoice))

  ptms.forEach((p) => {
    const sel = { resno: p.res_num }
    const highlighted = p.res_num === highlightResNum

    if (p.x !== null && p.y !== null && p.z !== null) {
      viewer.addSphere({
        center: { x: p.x, y: p.y, z: p.z },
        radius: highlighted ? 5.0 : p.dim ? 2.0 : 3.2,
        color: p.color,
        alpha: p.dim ? 0.45 : 0.95
      })
      if (highlighted || (!p.dim && !p.nolabel)) {
        viewer.addLabel(`${p.mod_aa}${p.res_num}`, {
          position: { x: p.x, y: p.y, z: p.z },
          backgroundColor: highlighted ? 'rgba(56,189,248,0.9)' : 'rgba(15,23,42,0.85)',
          fontColor: highlighted ? '#0f172a' : p.color,
          fontSize: highlighted ? 14 : 11,
          showBackground: true
        })
      }
    }

    viewer.addStyle(sel, { sphere: { color: p.color, scale: p.dim ? 0.5 : 0.8 } })
    viewer.setClickable(sel, true, () => onSelect(p))
  })
  viewer.render()
}

/**
 * Pan the camera so one residue sits in the center, keeping the zoom level.
 *
 * @param {object} viewer A 3Dmol viewer.
 * @param {object} p A PTM record; ignored when it has no coordinates in the model.
 */
export function centerSite (viewer, p) {
  if (p.x === null || p.y === null || p.z === null) return
  viewer.center({ resno: p.res_num }, 500)
}

/**
 * One 3Dmol panel per contrast, pooled: redrawing with an unchanged contrast set
 * reuses the loaded model and only redraws the site marks.
 */
export class ViewerPool {
  /** @param {HTMLElement} host The element that holds the panels side by side. */
  constructor (host) {
    this.host = host
    this.panels = new Map() // contrast -> { panel, viewer }
    this.pdbText = ''
  }

  /** A new protein invalidates every panel's loaded model. */
  setModel (pdbText) {
    this.pdbText = pdbText
    this.clear()
  }

  clear () {
    this.panels.forEach(({ panel }) => panel.remove())
    this.panels.clear()
  }

  #ensure (contrast) {
    let entry = this.panels.get(contrast)
    if (entry) return entry
    const panel = document.createElement('div')
    panel.className = 'viewer-panel'
    const label = document.createElement('div')
    label.className = 'panel-label'
    label.textContent = contrast
    const molHost = document.createElement('div')
    molHost.className = 'mol-host'
    panel.append(label, molHost)
    this.host.append(panel)
    const viewer = $3Dmol.createViewer(molHost, { backgroundColor: '#0b0f19' })
    viewer.addModel(this.pdbText, 'pdb')
    viewer.zoomTo()
    entry = { panel, viewer }
    this.panels.set(contrast, entry)
    return entry
  }

  /**
   * Draw the rows: one panel per contrast, removing panels no row needs.
   *
   * @param {Array<{contrast: string, ptms: object[]}>} rows Decorated sites per contrast.
   * @param {string} styleChoice Backbone color choice.
   * @param {{contrast: string, resNum: number}|null} highlighted The emphasized site.
   * @param {function(object): void} onSelect Called with the record when a sphere is clicked.
   */
  render (rows, styleChoice, highlighted, onSelect) {
    if (!this.pdbText) return
    const wanted = new Set(rows.map((row) => row.contrast))
    for (const [contrast, { panel }] of [...this.panels]) {
      if (!wanted.has(contrast)) {
        panel.remove()
        this.panels.delete(contrast)
      }
    }
    rows.forEach(({ contrast, ptms }) => {
      const { viewer } = this.#ensure(contrast)
      const highlightResNum = highlighted && highlighted.contrast === contrast ? highlighted.resNum : null
      renderPtmSites(viewer, ptms, styleChoice, onSelect, highlightResNum)
    })
    // Panel widths change with the panel count; 3Dmol must re-measure its canvases.
    requestAnimationFrame(() => this.resize())
  }

  /** Pan the panel of one contrast to a site, keeping the zoom level. */
  center (p) {
    const entry = this.panels.get(p.contrast)
    if (entry) centerSite(entry.viewer, p)
  }

  resize () {
    this.panels.forEach(({ viewer }) => {
      viewer.resize()
      viewer.render()
    })
  }
}
