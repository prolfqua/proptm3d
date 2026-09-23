# proptm3d browser app

This is the TypeScript frontend for an already prepared `output_3d` directory. Python `prepare` produces the Parquet data contract; `serve` remains a separate static server.

```sh
npm ci
npm test
npm run build
npm run deploy              # DPA, DPU, and CF-DPU
# or: npm run deploy -- DPA  # one method
```

`deploy` installs the built HTML/CSS/JavaScript and generates per-contrast static black-point plot backgrounds from the prepared results Parquet. It does not rewrite the prepared tables or structures. Run it again after `prepare` replaces a method directory, then run `proptm3d serve DPA` (or another method) and open the printed local URL. The browser reads its protein catalog, sites, DEA results, sample abundances, protein features, and structure-file metadata from Parquet; prepared method directories contain no CBOR files. `proteins.parquet` carries each protein's description from the source h5mu and precomputed UniProt and STRING links. All contrasts shows the protein table. Single contrast places the table beside a volcano and a protein/site scatter: hovering a row temporarily hides both all-protein backgrounds and shows only that protein's plottable sites, black for non-passing sites and red/blue for passing sites. Leaving the row restores every significant overlay and both black backgrounds; clicking still opens Protein detail. Single contrast sequlogos shows its own full volcano and protein/site scatter with sequence logos below. Browser data, image, and model requests are restricted to the served origin; no automatic request goes to UniProt, STRING, AlphaFold, or a CDN. External protein links are opened only when clicked.

For development, run `proptm3d serve DPA` on port 8000, then `npm run dev` in this directory; Vite proxies the prepared data and structures to that local server.
