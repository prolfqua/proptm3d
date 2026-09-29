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

To prepare all methods without choosing an output folder, pass only the input. The output is created
beside it as `proptm3d_<input basename>`:

```sh
uv run proptm3d prepare stats --input /path/to/PTM_delivery.zip
# output: /path/to/proptm3d_PTM_delivery/
# entry page: /path/to/proptm3d_PTM_delivery/index.html
```

Preparation writes the root method-chooser `index.html`, each method's browser HTML/JS/CSS and static plot backgrounds, and the Parquet tables. When supplied, the positional folder is the prepared output root; no `output_3d` subfolder is added. `--input` is required and points independently to the source data. Omitting the method prepares all three methods; omitting both method and folder also selects the default folder beside the input. `bundle --in FOLDER` then builds an all-method ZIP. `serve DPA FOLDER` still serves a prepared method directly. The Python CLI does not run npm or install browser dependencies.

To preview all prepared methods, run `proptm3d serve /path/to/viewer`, then open the HTTP URL printed in the terminal. Opening the root `index.html` directly shows the chooser, but the method applications require HTTP because browsers do not allow them to fetch their Parquet and compressed structure files reliably from `file://` URLs.

For the current `o43037_FP24_AntjePhospho` dataset, run [the fish example](../examples/o43037_prepare_bundle.fish) from an active `.venv` to prepare and bundle DPA, DPU, and CF-DPU in one ZIP. Its paths are literal, and the ZIP refuses to overwrite an existing file.

For completed enrichment analysis, provide either a PTM delivery ZIP or its unpacked folder containing `PTM_results.h5mu` and the recognized GSEA artifacts:

```sh
uv run proptm3d prepare gsea DPA /path/to/viewer --input /path/to/PTM_delivery.zip
# or: --input /path/to/PTM_delivery/
```

`prepare stats` can also accept an unpacked delivery folder, a statistics delivery ZIP containing `PTM_statistics.h5mu`, or a completed delivery ZIP containing `PTM_results.h5mu`. When both h5mu stages are present, it uses `PTM_results.h5mu`. Run `proptm3d bundle /path/to/viewer` to bundle every prepared method behind the shared entry page. These commands need network access only while filling the preparation cache; the browser itself reads the served files.

The ZIP contains `serve.py`, `serve.sh`, and `serve.bat` by default, so a recipient can run the extracted site locally without installing proptm3d. Python 3 is the only runtime requirement; see the [bundle guide](bundles.md) for launch commands. Pass `--no-include-server` to omit these files.

To upload the cached PTM Pipeline delivery and completed proptm3d bundle to B-Fabric, run:

```sh
uv run proptm3d upload 43037 "ptm-pipeline_analysis_v3"
```

The command shows both files and asks whether the cached pair is correct. Answer `n` to enter both
artifact paths manually. It then asks before creating separate workunits in applications 431 and
434. See the [B-Fabric upload guide](bfabric.md) for cache discovery, credentials, and server-side
verification details.
