# Prepared data contract

Each method is exported directly under the explicitly selected folder as `FOLDER/DPA`, `FOLDER/DPU`, or `FOLDER/CF-DPU`. The `data/run.json` manifest identifies the method, preparation kind, available files, contrasts, samples, and coverage counts. Python serves exactly one prepared method directory; it does not proxy external services.

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

Structure models are exposed from `structures/`. Residue-context Parquet files are linked from the completed cache under `residue_context/`, loaded only when a protein detail is opened, and included as regular files in bundles. Python preparation writes the packaged HTML/JavaScript application, a `data/browser-assets.json` inventory of its generated JavaScript/CSS files, and precomputed black-point plot backgrounds under `data/` alongside the Parquet tables. The completed delivery ZIP may hold `result_*.cbor.gz` files as inputs to GSEA extraction, but those CBOR files are not served.

Preparation keeps the shared cache outside the method directory, writes to a staging directory, and replaces only a directory carrying a valid `proptm3d-prepared-method` manifest. A failed preparation leaves the previous package usable. `proptm3d clean FOLDER` removes the whole validated prepared root, not the input or shared cache; it refuses unrelated user files.
