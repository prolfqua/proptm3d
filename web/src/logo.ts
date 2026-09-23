import { isSignificant } from "./summary.js";
import type { SiteIndexRow, Thresholds } from "./types.js";

export const AMINO_ACIDS = [
  "A", "C", "D", "E", "F", "G", "H", "I", "K", "L",
  "M", "N", "P", "Q", "R", "S", "T", "V", "W", "Y",
] as const;

export type AminoAcid = typeof AMINO_ACIDS[number];
export interface LogoColumn {
  position: number;
  frequencies: Record<AminoAcid, number>;
}
export type LogoMatrix = LogoColumn[];

export interface LogoData {
  up: LogoMatrix | null;
  down: LogoMatrix | null;
  difference: LogoMatrix | null;
  upCount: number;
  downCount: number;
  invalidWindowCount: number;
}

const WINDOW_LENGTH = 15;
const CENTER = 7;
const VALID_WINDOW = /^[ACDEFGHIKLMNPQRSTVWYX]{15}$/;

function centeredWindow(row: SiteIndexRow): string | null {
  const window = row.sequence_window?.toUpperCase() ?? "";
  if (!VALID_WINDOW.test(window) || window[CENTER] !== row.modAA?.toUpperCase()) {
    return null;
  }
  return window;
}

function emptyFrequencies(): Record<AminoAcid, number> {
  return Object.fromEntries(AMINO_ACIDS.map((aa) => [aa, 0])) as Record<AminoAcid, number>;
}

function frequencyMatrix(windows: string[]): LogoMatrix | null {
  if (windows.length === 0) return null;
  const matrix = Array.from({ length: WINDOW_LENGTH }, (_, index) => ({
    position: index - CENTER,
    frequencies: emptyFrequencies(),
  }));
  for (const window of windows) {
    for (let index = 0; index < WINDOW_LENGTH; index++) {
      const aa = window[index];
      if (aa !== "X") matrix[index].frequencies[aa as AminoAcid]++;
    }
  }
  for (const column of matrix) {
    for (const aa of AMINO_ACIDS) column.frequencies[aa] /= windows.length;
  }
  return matrix;
}

export function computeLogos(
  rows: SiteIndexRow[],
  contrast: string,
  thresholds: Thresholds,
): LogoData {
  const upWindows: string[] = [];
  const downWindows: string[] = [];
  let invalidWindowCount = 0;
  for (const row of rows) {
    if (row.contrast !== contrast || !isSignificant(row, thresholds)) continue;
    const window = centeredWindow(row);
    if (window === null) {
      invalidWindowCount++;
      continue;
    }
    if (row.effect! > 0) upWindows.push(window);
    else downWindows.push(window);
  }

  const up = frequencyMatrix(upWindows);
  const down = frequencyMatrix(downWindows);
  const difference = up && down
    ? up.map((column, index) => {
      const frequencies = emptyFrequencies();
      for (const aa of AMINO_ACIDS) {
        frequencies[aa] = column.frequencies[aa] - down[index].frequencies[aa];
      }
      return { position: column.position, frequencies };
    })
    : null;
  return {
    up,
    down,
    difference,
    upCount: upWindows.length,
    downCount: downWindows.length,
    invalidWindowCount,
  };
}
