# Prepared data contract

Each method is exported directly under the explicitly selected folder as `FOLDER/DPA`, `FOLDER/DPU`, or `FOLDER/CF-DPU`. The `data/run.json` manifest identifies the method, preparation kind, available files, contrasts, samples, and coverage counts. `serve METHOD FOLDER` serves one method, while `serve FOLDER` adds an in-memory overview for all prepared methods. Neither mode proxies external services or modifies the prepared root.

Statistics preparation reads MuData schema `2.0.0` from either `PTM_statistics.h5mu` or the statistics-bearing `PTM_results.h5mu` in a completed delivery. Result tables are AnnData data frames stored directly in `varm`, with one row per modality feature. Every matching key contributes a contrast: `enriched/varm/dpa__<contrast>` for DPA, `enriched/varm/dpu__<contrast>` for DPU, and `enriched_CF/varm/correct_first_protein_imputed__<contrast>` for CF-DPU. CF-DPU uses the protein-imputed CorrectFirst abundance matrix in `enriched_CF/layers/correct_first_protein_imputed`. The old `mod/cf` and split result-matrix representation are not supported.

Only rows with an `observed` site-level estimate are exported as statistical results. DPU rows remain eligible when the site estimate is observed and the paired protein estimate is imputed. All measured sites remain in `sites.parquet`, so a site excluded from the statistical results is still available as measured evidence without a result.

| Path | Contents |
| --- | --- |
| `tables/proteins.parquet` | Protein catalog, descriptions, and prepared external links |
| `tables/sites.parquet` | Every measured real-protein phosphosite, including those without a DEA estimate |
| `tables/site_stats.parquet` | Method-specific site effects and FDR, keyed by protein, site, and contrast |
| `tables/measurements.parquet` | Sample-aligned site and protein abundances; missing values remain null |
| `tables/protein_features.parquet` | UniProt feature positions, descriptions, and evidence |
| `tables/structures.parquet` | Available AlphaFold model coordinates and served structure, PAE, and residue-context paths |
| `tables/site_structural_context.parquet` | Precomputed per-site pLDDT, exposure, IDR, and mapping status |
| `residue_context/*.parquet` | Referenced models' per-residue exposure and IDR calls, loaded only for the selected protein |
| `tables/gsea_terms.parquet` | Enrichment terms; present only after `prepare gsea` |

Structure models are exposed from `structures/`. Residue-context Parquet files are linked from the completed cache under `residue_context/`, loaded only when a protein detail is opened, and included as regular files in bundles. Python preparation writes the packaged HTML/JavaScript application, a `data/browser-assets.json` inventory of its generated JavaScript/CSS files, and precomputed black-point plot backgrounds under `data/` alongside the Parquet tables. The completed delivery ZIP holds raw gzipped protsea `result_*.json.gz` documents as checksum-validated inputs to GSEA extraction; those source documents are not served.

Preparation keeps the shared cache outside the method directory, writes to a staging directory, and replaces only a directory carrying a valid `proptm3d-prepared-method` manifest. A failed preparation leaves the previous package usable. `proptm3d clean FOLDER` removes the whole validated prepared root, not the input or shared cache; it refuses unrelated user files.
