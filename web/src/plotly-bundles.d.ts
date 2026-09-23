interface PlotlyClickEvent {
  points: Array<{ customdata?: unknown; x?: unknown; y?: unknown }>
}

interface PlotlyGraph extends HTMLDivElement {
  removeAllListeners(event: 'plotly_click'): void
  on(event: 'plotly_click', handler: (event: PlotlyClickEvent) => void): void
}

interface PlotlyBundle {
  react(
    element: HTMLDivElement,
    data: Record<string, unknown>[],
    layout: Record<string, unknown>,
    config: { responsive: boolean; displaylogo: boolean; modeBarButtonsToRemove: string[] },
  ): Promise<PlotlyGraph>
  update(
    element: HTMLDivElement,
    dataUpdate: object,
    layoutUpdate: Record<string, unknown>,
    traceIndices: number[],
  ): Promise<PlotlyGraph>
  Plots: { resize(element: HTMLElement): void }
}

declare module 'plotly.js-gl2d-dist-min' {
  const Plotly: PlotlyBundle
  export default Plotly
}

declare module 'plotly.js-cartesian-dist-min' {
  const Plotly: PlotlyBundle
  export default Plotly
}
