// The application shell: global chrome (title, workspace tabs, the contrast and
// display selects, the status line) and the two workspaces' layouts with the
// hosts the composition root renders tables, 3D panels and the figure into.
//
// A humble view: it owns no data and makes no decisions. Every control emits an
// `intent` event with {type, value}; app.js applies it to the session and
// re-renders. Light DOM, deliberately: Tabulator and Plotly append their rules
// to document.head and those do not cross a shadow boundary.

import { LitElement, html, nothing } from '../vendor/lit.js'

export const WORKSPACES = [
  { id: 'find', title: 'Find' },
  { id: 'protein', title: 'Protein' }
]

const PLDDT_LEGEND = [
  ['#1d4ed8', '> 90 very high'],
  ['#38bdf8', '70-90 confident'],
  ['#facc15', '50-70 low'],
  ['#f97316', '< 50 very low']
]

class PtmApp extends LitElement {
  static properties = {
    workspace: { type: String },
    proteinLabel: { type: String },
    contrasts: { type: Array },
    contrast: { type: String },
    hasCategories: { type: Boolean },
    memberMode: { type: String },
    colorBy: { type: String },
    styleChoice: { type: String },
    status: { type: String },
    meta: { type: String },
    matched: { type: Number },
    total: { type: Number },
    pmlFile: { type: String },
    leftWidth: { type: Number },
    findSplit: { type: Number },
    ntocHeight: { type: Number }
  }

  createRenderRoot () {
    return this
  }

  constructor () {
    super()
    this.workspace = 'find'
    this.proteinLabel = ''
    this.contrasts = []
    this.contrast = ''
    this.hasCategories = false
    this.memberMode = 'leading'
    this.colorBy = 'log2fc'
    this.styleChoice = 'plddt'
    this.status = ''
    this.meta = 'Loading catalog...'
    this.matched = 0
    this.total = 0
    this.pmlFile = ''
    this.leftWidth = 560
    this.findSplit = 520
    this.ntocHeight = 250
  }

  #emit (type, value) {
    this.dispatchEvent(new CustomEvent('intent', { detail: { type, value }, bubbles: true }))
  }

  /** Drag a vertical splitter; `apply` receives the new left width while dragging. */
  #drag (event, current, apply) {
    event.preventDefault()
    const splitter = event.currentTarget
    splitter.classList.add('dragging')
    const startX = event.clientX
    const move = (e) => apply(Math.min(Math.max(current + e.clientX - startX, 280), window.innerWidth - 360))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      splitter.classList.remove('dragging')
      this.#emit('layout', null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  #select (label, type, value, options) {
    return html`
      <label>${label}</label>
      <select .value=${value} @change=${(e) => this.#emit(type, e.target.value)}>
        ${options.map(([id, title]) => html`<option value=${id} ?selected=${id === value}>${title}</option>`)}
      </select>
    `
  }

  #tabs () {
    return WORKSPACES.map(({ id, title }) => {
      const label = id === 'protein' && this.proteinLabel ? `${title}: ${this.proteinLabel}` : title
      const disabled = id === 'protein' && !this.proteinLabel
      return html`
        <button
          class="tab ${this.workspace === id ? 'active' : ''}"
          ?disabled=${disabled}
          @click=${() => this.#emit('workspace', id)}
        >
          ${label}
        </button>
      `
    })
  }

  render () {
    return html`
      <header class="toolbar">
        <h1>proptm3d</h1>
        <nav class="tabs">${this.#tabs()}</nav>
        ${this.#select('Contrast', 'contrast', this.contrast, [
          ['', 'All contrasts'],
          ...this.contrasts.map((c) => [c, c])
        ])}
        ${this.hasCategories
          ? this.#select('Members', 'member-mode', this.memberMode, [
              ['leading', 'Leading edge'],
              ['members', 'Full set']
            ])
          : nothing}
        ${this.#select('Color', 'color-by', this.colorBy, [
          ['log2fc', 'log2FC'],
          ['category', 'Category']
        ])}
        ${this.#select('Backbone', 'style', this.styleChoice, [
          ['plddt', 'pLDDT confidence'],
          ['spectrum', 'N-to-C spectrum'],
          ['slate', 'Slate gray']
        ])}
        ${this.pmlFile ? html`<a href=${this.pmlFile} download>PyMOL script</a>` : nothing}
        <span class="status">${this.status || this.meta}</span>
      </header>

      <section class="workspace" ?hidden=${this.workspace !== 'find'}>
        <div class="main-row">
          <div class="left-col ${this.hasCategories ? '' : 'hidden'}" style="width:${this.findSplit}px">
            <div class="pane">
              <div class="pane-title">Categories</div>
              <div class="pane-body"><div id="categoriesTable"></div></div>
            </div>
          </div>
          <div
            class="splitter ${this.hasCategories ? '' : 'hidden'}"
            @pointerdown=${(e) => this.#drag(e, this.findSplit, (w) => { this.findSplit = w })}
          ></div>
          <div class="right-col">
            <div class="pane">
              <div class="pane-title">
                Proteins
                <span class="count">${this.matched} of ${this.total}</span>
                <span class="hint">click a row to open it in the Protein tab</span>
              </div>
              <div class="pane-body"><div id="proteinTable"></div></div>
            </div>
          </div>
        </div>
      </section>

      <section class="workspace" ?hidden=${this.workspace !== 'protein'}>
        <div class="main-row">
          <div class="left-col" style="width:${this.leftWidth}px">
            <div class="pane">
              <div class="pane-title">PTM sites</div>
              <div class="pane-body"><div id="ptmTable"></div></div>
            </div>
          </div>
          <div
            class="splitter"
            @pointerdown=${(e) => this.#drag(e, this.leftWidth, (w) => { this.leftWidth = w })}
          ></div>
          <div class="right-col">
            <div class="viewer-host">
              <div id="viewers"></div>
              <div class="legend">
                <div class="legend-title">pLDDT</div>
                ${PLDDT_LEGEND.map(([color, label]) => html`
                  <div class="legend-row"><i style="background:${color}"></i>${label}</div>
                `)}
                <div class="legend-title">log2FC</div>
                <div class="legend-scale"><span>down</span><i></i><span>up</span></div>
              </div>
            </div>
            <div class="ntoc-pane" style="height:${this.ntocHeight}px">
              <div class="pane-title">N-to-C</div>
              <div id="ntoc" class="pane-body"></div>
            </div>
          </div>
        </div>
      </section>
    `
  }
}

customElements.define('ptm-app', PtmApp)
