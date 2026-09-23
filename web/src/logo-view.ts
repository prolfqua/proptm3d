import { AMINO_ACIDS } from './logo'
import type { AminoAcid, LogoMatrix } from './logo'

const WIDTH = 660
const HEIGHT = 225
const LEFT = 37
const STEP = 40
const COLORS: Record<AminoAcid, string> = {
  A: '#546e7a', C: '#d19a1d', D: '#cf4a40', E: '#cf4a40', F: '#7956a6',
  G: '#607d8b', H: '#3568a0', I: '#546e7a', K: '#3568a0', L: '#546e7a',
  M: '#546e7a', N: '#318b72', P: '#8b658a', Q: '#318b72', R: '#3568a0',
  S: '#318b72', T: '#318b72', V: '#546e7a', W: '#7956a6', Y: '#7956a6',
}

function letter(aa: AminoAcid, x: number, top: number, height: number): string {
  if (height < 2.5) return ''
  const y = top + height * 0.91
  const fontSize = Math.max(5, height * 1.12)
  return `<text x="${x}" y="${y.toFixed(2)}" font-size="${fontSize.toFixed(2)}" text-anchor="middle" textLength="${Math.min(30, Math.max(5, height * 0.75)).toFixed(2)}" lengthAdjust="spacingAndGlyphs" fill="${COLORS[aa]}" font-family="Arial, sans-serif" font-weight="700">${aa}</text>`
}

export function renderLogo(
  host: HTMLElement,
  matrix: LogoMatrix | null,
  signed: boolean,
  emptyMessage: string,
): void {
  if (!matrix) {
    host.replaceChildren()
    const note = document.createElement('p')
    note.className = 'empty-note'
    note.textContent = emptyMessage
    host.append(note)
    return
  }
  const baseline = signed ? 105 : 183
  const unitHeight = signed ? 73 : 153
  const letters: string[] = []
  for (let index = 0; index < matrix.length; index++) {
    const column = matrix[index]
    const x = LEFT + index * STEP + STEP / 2
    const entries = AMINO_ACIDS.map((aa) => ({ aa, value: column.frequencies[aa] }))
    let up = baseline
    for (const { aa, value } of entries.filter(({ value }) => value > 0).sort((a, b) => a.value - b.value)) {
      const height = value * unitHeight
      up -= height
      letters.push(letter(aa, x, up, height))
    }
    if (signed) {
      let down = baseline
      for (const { aa, value } of entries.filter(({ value }) => value < 0).sort((a, b) => b.value - a.value)) {
        const height = -value * unitHeight
        letters.push(letter(aa, x, down, height))
        down += height
      }
    }
  }
  const ticks = matrix.map((column, index) => {
    const x = LEFT + index * STEP + STEP / 2
    const text = column.position > 0 ? `+${column.position}` : `${column.position}`
    return `<text x="${x}" y="207" text-anchor="middle" font-size="11" fill="#5c6570">${text}</text>`
  }).join('')
  const centre = LEFT + 7 * STEP + STEP / 2
  const scale = signed
    ? '<text x="6" y="34" font-size="10" fill="#5c6570">+1</text><text x="6" y="108" font-size="10" fill="#5c6570">0</text><text x="6" y="181" font-size="10" fill="#5c6570">−1</text>'
    : '<text x="6" y="33" font-size="10" fill="#5c6570">1</text><text x="6" y="185" font-size="10" fill="#5c6570">0</text>'
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${signed ? 'Signed amino-acid frequency difference' : 'Amino-acid frequency sequence logo'}"><line x1="${LEFT}" y1="${baseline}" x2="${LEFT + 15 * STEP}" y2="${baseline}" stroke="#89929c" stroke-width="1"/><line x1="${centre}" y1="12" x2="${centre}" y2="193" stroke="#b7c5d2" stroke-dasharray="3 3"/>${scale}${letters.join('')}${ticks}<text x="${WIDTH / 2}" y="222" text-anchor="middle" font-size="10" fill="#5c6570">Position relative to modified residue</text></svg>`
}
