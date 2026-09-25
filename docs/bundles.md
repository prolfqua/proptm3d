# Portable ZIP deployment

A prepared output folder may contain one or more of DPA, DPU, and CF-DPU. The folder is always explicit; it can be called `viewer`, `output_3d`, or anything else. `proptm3d bundle` with no arguments lists prepared folders recorded for the current user and shows which methods are currently available in each.

After [preparing the analysis](quickstart.md), make a ZIP for one method, a selected subset, or all available methods:

```sh
uv run proptm3d bundle DPA --in /path/to/viewer --out /path/to/DPA.zip
uv run proptm3d bundle DPA DPU --in /path/to/viewer --out /path/to/DPA-DPU.zip
uv run proptm3d bundle --in /path/to/viewer --out /path/to/all-methods.zip
uv run proptm3d bundle DPA --in /path/to/viewer --out /path/to/DPA-static-only.zip --no-include-server
```

`--out` is optional. Without it, the ZIP is written beside the prepared folder as `viewer-DPA.zip`, `viewer-DPA-DPU.zip`, or `viewer-all.zip`. An existing ZIP is never overwritten. A single-method archive opens directly into the app at its root `index.html`; two or more methods open a self-contained overview page with a method comparison table, prepared coverage counts, provenance, and links to each viewer. Every bundle has one `shared/` folder containing each referenced AlphaFold structure, PAE file, and residue-context Parquet file once. The method-specific `structures.parquet` files inside the ZIP point to these shared files; preparation output remains unchanged. Python preparation already includes the built browser app and static black-point images. No cache symlinks or original h5mu files are needed at the destination.

Preparation records all packaged JavaScript and CSS in `data/browser-assets.json`. Bundling verifies that inventory and the asset references in `index.html`; if a chunk is missing, it fails before writing the ZIP. Re-prepare a folder made by an older version that lacks the inventory or Python-generated backgrounds.

To publish, **extract** the ZIP into a directory served over HTTPS or HTTP, then open that directory's `index.html`. A ZIP download or `file://` URL is not an app deployment. For local preview, `proptm3d serve /path/to/DPA.zip` validates the archive, extracts it to a temporary folder, and serves that folder until stopped. To preview all methods before bundling, `proptm3d serve /path/to/viewer` serves the same chooser directly from the prepared folder without writing an index file there. The server must serve nested `.js`, `.css`, `.parquet`, `.png`, `.cif.gz`, and `.json.gz` paths from the same origin; no application server or external browser data source is required. Test the target server with a real archive before sharing the link. The FGCZ GenericZip location is authentication-protected, but its ZIP extraction and size limits have not been verified.

Every bundle includes three launchers at the ZIP root. After extracting the archive, run `./serve.sh` on macOS/Linux (or `sh serve.sh` if executable permissions were lost), `serve.bat` on Windows, or `python3 serve.py` directly. Open `http://127.0.0.1:8000/`; add `--port 8001` to use another port. The server binds only to `127.0.0.1` and requires Python 3, but it does not need proptm3d, pip, Node, npm, or internet access. Pass `--no-include-server` to omit the launchers when only an existing static web server will be used.

Bundles can be large: the current example DPA method references approximately 1.9 GiB of compressed structures and PAE files. Shared assets prevent repeated copies in a multi-method ZIP. The bundler streams ZIP64 output and reports its final size.

`proptm3d clean /path/to/viewer` removes the whole prepared folder and its history entry only when its contents are recognized as generated files. Re-preparation applies the same ownership check to an existing method. It refuses a folder containing unrelated user files, and it never deletes the source input or shared AlphaFold/UniProt cache. If a `.METHOD.previous` recovery folder remains after an interrupted operation, inspect it manually before retrying; preparation will not delete it.
