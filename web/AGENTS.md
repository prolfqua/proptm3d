# proptm3d TypeScript frontend

## Overview

This directory owns the static browser app only. Follow the [scenario plan](../../TODO/proptm3d/TODO_no_enrichment_browser_app.md) and [build instructions](README.md). Python `prepare`, cache, CLI, and `serve` are separate from routine UI changes; coordinate with `prepare` when the prepared-data contract changes.

## Setup

Start from an explicitly chosen prepared output folder with method directories; run `npm ci` before the commands below.

## Commands

```sh
npm run check
npm test
npm run build
cd .. && make package-web
```

## Code style

Keep prepared-payload types in `src/types.ts` and preserve null effects, FDRs, and sample values. Strict significance uses `fdr < cutoff` and `abs(effect) > cutoff`.

## Security

The browser loads local Parquet tables and self-hosted libraries only. It must not read CBOR or h5mu, call a CDN, or fetch UniProt/AlphaFold; those downloads are completed before the app runs.

## Checklist

Run the commands above and smoke DPA, DPU, and CF-DPU before handoff. Python preparation writes `data/plot_backgrounds.json` and its PNGs; browser development must not generate them. The checked-in browser build under `../src/proptm3d/browser_static/` must match the current TypeScript source.

## Examples

Use `loadProteinDetail` for a selected protein and `loadParquetTable` for a complete prepared table; see `src/data.ts`.

## When stuck

Check the prepared method's `data/run.json`, then [README.md](README.md). The old JavaScript frontend is archived at `../legacy/legacy-browser-2026-09-23.zip`; do not consult or port it.
