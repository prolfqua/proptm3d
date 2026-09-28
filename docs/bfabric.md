# Upload results to B-Fabric

After a successful `prepare` and `bundle`, proptm3d records the source PTM Pipeline delivery and
the derived all-method proptm3d bundle in a user-level artifact cache. Supply only the order and
workunit name:

```sh
uv run proptm3d upload 43037 "ptm-pipeline_analysis_v3"
```

The command validates both cached ZIPs, prints their absolute paths, sizes, and destination
applications, and asks whether it found the correct pair. Answering `n` prompts for the PTM
Pipeline result ZIP and proptm3d bundle ZIP paths, validates those replacements, and records the
corrected pair for the next run. A final confirmation is required before creating two separate
workunits with the supplied name:

| Artifact | B-Fabric application | Saved client-credentials environment |
| --- | --- | --- |
| Completed PTM Pipeline delivery containing `PTM_results.h5mu` | 431, **PTM Pipeline** | `app-431-ptm-pipeline` |
| Portable all-method proptm3d browser bundle | 434, **proptm3d** | `app-431-ptm-pipeline` |

Both application uploads use the same saved client credentials. Both connections are established
before either workunit is created, so a missing credential does not leave only the first workunit
behind. The environment is an application client-credentials login with `api:write tus`; no
interactive `bfabric-cli login` is needed. Its configured target can be inspected without changing
it:

```sh
bfabric-cli auth status --config-env app-431-ptm-pipeline
```

The order must exist in the selected environment. FGCZ production orders are not mirrored in the
test instance. Re-running a confirmed upload creates another pair of workunits and uploads the ZIPs
again.

An explicit third positional ZIP bypasses pair discovery and uploads only a validated proptm3d
bundle through application 434:

```sh
uv run proptm3d upload 43037 "proptm3d viewer" /path/to/viewer-all.zip
```

A successful command reports the workunit and resource ID for each transfer. It confirms that the
client-side transfer completed; B-Fabric then performs its server-side virus, checksum, and storage
checks. Keep the local ZIPs until both resources are shown as available in B-Fabric. Interrupted
transfers retain their resumable upload state. During each transfer, an interactive terminal shows
the filename, percentage, bytes transferred, transfer speed, and estimated time remaining.
