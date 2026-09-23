# Prepared data contract

Each method is exported to `output_3d/DPA`, `output_3d/DPU`, or `output_3d/CF-DPU`. The `data/run.json` manifest identifies the method, preparation kind, available files, contrasts, samples, and coverage counts. Python serves exactly one prepared method directory; it does not proxy external services.

| Path | Contents |
| --- | --- |
| `tables/proteins.parquet` | Protein catalog, descriptions, and prepared external links |
| `tables/sites.parquet` | Every measured real-protein phosphosite, including those without a DEA estimate |
| `tables/site_stats.parquet` | Method-specific site effects and FDR, keyed by protein, site, and contrast |
| `tables/measurements.parquet` | Sample-aligned site and protein abundances; missing values remain null |
| `tables/protein_features.parquet` | UniProt feature positions, descriptions, and evidence |
| `tables/structures.parquet` | Available AlphaFold model coordinates and served paths |
| `tables/site_structural_context.parquet` | Precomputed per-site pLDDT, exposure, IDR, and mapping status |
| `tables/gsea_terms.parquet` | Enrichment terms; present only after `prepare gsea` |

Structure models are exposed from `structures/`. The browser deployment adds the HTML/JavaScript application and precomputed black-point plot backgrounds under `data/`; it does not modify the Parquet tables. The completed delivery ZIP may hold `result_*.cbor.gz` files as inputs to GSEA extraction, but those CBOR files are not served.

Preparation keeps the shared cache outside the method directory, writes to a staging directory, and replaces only a directory carrying a valid `proptm3d-prepared-method` manifest. A failed preparation leaves the previous package usable. `proptm3d clean DPA --output-dir output_3d` removes only that owned method folder, not the input or shared cache.
