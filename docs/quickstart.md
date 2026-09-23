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

Prepare statistics from a `PTM_statistics.h5mu` file, then deploy the browser build into the prepared method folder and serve it:

```sh
uv run proptm3d prepare stats DPA --input /path/to/PTM_statistics.h5mu --output-dir output_3d
npm ci --prefix web
npm --prefix web run build
npm --prefix web run deploy -- DPA
uv run proptm3d serve DPA --output-dir output_3d --port 8000
```

Open `http://127.0.0.1:8000/`. Preparation prints the resulting directory and corresponding serve command. Omitting the method from `prepare stats` prepares all three methods; `serve` always takes one method. Re-run browser deployment after preparation replaces a method directory.

For completed enrichment analysis, provide a PTM delivery ZIP containing `PTM_results.h5mu` and the recognized GSEA artifacts:

```sh
uv run proptm3d prepare gsea DPA --input /path/to/PTM_delivery.zip --output-dir output_3d
```

`prepare stats` can also accept a statistics delivery ZIP directly. These commands need network access only while filling the preparation cache; the browser itself reads the served files.
