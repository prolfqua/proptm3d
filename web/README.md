# proptm3d browser app

This is the TypeScript frontend for an explicitly selected prepared output folder. Python `prepare` writes both the Parquet data and the static browser app; `serve` remains a separate static server. npm is needed only for browser development, not for normal analysis preparation or bundling.

```sh
npm ci
npm test
cd .. && make package-web   # copy the new build into the Python package
```

The checked-in `src/proptm3d/browser_static/` contains the production build shipped in the Python wheel. `make package-web` rebuilds and updates it; `make check` verifies it matches the TypeScript source. Python preparation installs those files and generates per-contrast static black-point backgrounds from Parquet. A portable ZIP can be produced with `proptm3d bundle DPA --in /path/to/viewer` immediately after preparation. The browser reads its protein catalog, sites, DEA results, sample abundances, protein features, structure-file metadata, and optional GSEA tables from Parquet; prepared method directories contain no CBOR files. `proteins.parquet` carries each protein's description from the source h5mu and precomputed UniProt and STRING links. The shared filtering panel places each control beside its UpSet; hiding the UpSets leaves a short selected-site, A/B/C and active-property summary alongside the always-visible contrast context and protein search. A compares significant-site sets across contrasts; B compares GSEA-FDR-eligible sequence_sets, optionally using leading-edge memberships. Both support Off, All (union), whole-set and exact-intersection selection. C combines their outputs with Estimate, Exposure and Region and defaults to **union**, not AND. Its plot shows combinations passing every active property choice and A or B (when active); this display restriction does not change the union. Disabled operands do not broaden that union. C contains its selection count, Clear C and Show all sites; Clear C preserves upstream selections, and Show all sites suspends/restores the complete hierarchy. Contrast context and the focused running curve are independent of filtering.

All protein, detail, abundance, logo and plot-highlight views consume C's deduplicated site identities, including measured sites with no estimate. Statistical plots preserve their background and distinguish selected significant/non-significant sites. GSEA's full curve is unchanged; selected hits are highlighted and its site table adds log2FC/site FDR. Search/paging affects display only. See [the browser guide](../docs/browser.md) for state transitions and examples.

The reusable UpSet model, display projection, figure builder, and plot component are in `src/upset.ts`. The component owns its Selected/All view state and top-left in-plot toggle. In every panel, its named-set Selected view puts the chosen set first and makes left bars count overlap within the matching intersections; View All restores global set sizes. This changes only the display, never exact memberships or site selection. `src/filtering.ts` constructs A/B/property sets and resolves C; `src/filter-panel.ts` supplies their models and receives site-selection clicks. Existing view controllers consume the result rather than applying serial predicates. Original GSEA window ranks are joined by identity during preparation; re-run `prepare gsea` to correct already-prepared rank values.

Browser data, image, and model requests are restricted to the served origin; no automatic request goes to UniProt, STRING, AlphaFold, or a CDN. External protein links are opened only when clicked.

For development, run `proptm3d serve DPA /path/to/viewer` on port 8000, then `npm run dev` in this directory; Vite proxies the prepared data, structures, and PAE to that local server.
