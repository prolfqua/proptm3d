# proptm3d browser app

This is the TypeScript frontend for an explicitly selected prepared output folder. Python `prepare` writes both the Parquet data and the static browser app; `serve` remains a separate static server. npm is needed only for browser development, not for normal analysis preparation or bundling.

```sh
npm ci
npm test
cd .. && make package-web   # copy the new build into the Python package
```

The checked-in `src/proptm3d/browser_static/` contains the production build shipped in the Python wheel. `make package-web` rebuilds and updates it; `make check` verifies it matches the TypeScript source. Python preparation installs those files and generates per-contrast static black-point backgrounds from Parquet. A portable ZIP can be produced with `proptm3d bundle DPA --in /path/to/viewer` immediately after preparation. The browser reads its protein catalog, sites, DEA results, sample abundances, protein features, and structure-file metadata from Parquet; prepared method directories contain no CBOR files. `proteins.parquet` carries each protein's description from the source h5mu and precomputed UniProt and STRING links. All contrasts shows a site-level UpSet plot above the protein table; selecting an exact contrast intersection filters the table, Protein detail, and Site abundance to its sites and bearer proteins. A toggle beside the other shared filters suspends or restores that selection without forgetting it and reports the selected site and protein counts in every workspace. While active, the selection also limits the Displayed contrast dropdown to the exact intersection's contrasts. Single contrast places the table beside a volcano and a protein/site scatter: an active UpSet selection limits their interactive overlays to selected sites, using amber for selected sites that do not pass in the displayed contrast and red/blue for those that do. Hovering a row isolates that protein's selected points; clicking opens Protein detail. Single contrast sequlogos applies the same selection to its plots and sequence-logo inputs. Browser data, image, and model requests are restricted to the served origin; no automatic request goes to UniProt, STRING, AlphaFold, or a CDN. External protein links are opened only when clicked.

For development, run `proptm3d serve DPA /path/to/viewer` on port 8000, then `npm run dev` in this directory; Vite proxies the prepared data, structures, and PAE to that local server.
