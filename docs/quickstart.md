# Prepare and serve

Install the locked environment from the repository root:

```sh
make sync
```

First create the shared AlphaFold structure and residue-context cache for the organism in the source data. `HUMAN` and `MOUSE` are supported:

```sh
uv run proptm3d cache context MOUSE
```

This downloads AlphaFold models and PAE files and computes structural context for the reference proteome. It is independent of the analysis method and can take substantial time and disk space. `uv run proptm3d cache` reports local cache availability. Preparation requires a complete matching context cache.

Prepare statistics from a `PTM_statistics.h5mu` file, create a complete static ZIP, and preview that ZIP locally:

```sh
uv run proptm3d prepare stats DPA /path/to/viewer --input /path/to/PTM_statistics.h5mu
uv run proptm3d bundle DPA --in /path/to/viewer --out /path/to/DPA.zip
uv run proptm3d serve /path/to/DPA.zip
```

Open `http://127.0.0.1:8000/`. Preparation writes the browser HTML/JS/CSS and static plot backgrounds together with the Parquet tables, so the ZIP is ready even if `serve` has never run. The positional folder is the prepared output root; no `output_3d` subfolder is added. `--input` is required and points independently to the source data. Omitting the method from `prepare stats` prepares all three methods; `bundle --in FOLDER` then builds an all-method ZIP. `serve DPA FOLDER` still serves a prepared method directly. The Python CLI does not run npm or install browser dependencies.

To preview all prepared methods directly, run `proptm3d serve /path/to/viewer`. It serves the same landing page as an all-method ZIP without bundling or modifying the prepared folder.

For the current `o43037_FP24_AntjePhospho` dataset, run [the fish example](../examples/o43037_prepare_bundle.fish) from an active `.venv` to prepare and bundle DPA, DPU, and CF-DPU in one ZIP. Its paths are literal, and the ZIP refuses to overwrite an existing file.

For completed enrichment analysis, provide a PTM delivery ZIP containing `PTM_results.h5mu` and the recognized GSEA artifacts:

```sh
uv run proptm3d prepare gsea DPA /path/to/viewer --input /path/to/PTM_delivery.zip
```

`prepare stats` can also accept a statistics delivery ZIP directly. These commands need network access only while filling the preparation cache; the browser itself reads the served files.

The ZIP contains `serve.py`, `serve.sh`, and `serve.bat` by default, so a recipient can run the extracted site locally without installing proptm3d. Python 3 is the only runtime requirement; see the [bundle guide](bundles.md) for launch commands. Pass `--no-include-server` to omit these files.
