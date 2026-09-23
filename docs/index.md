# proptm3d

`proptm3d` prepares phosphosite statistics, aligned sample abundances, protein annotations, and AlphaFold structural context for a static browser app. Python reads the source MuData and prepares one local directory per analysis method; the TypeScript app reads only the files served from those directories.

```{toctree}
:maxdepth: 2

quickstart
data
api
development
```

The supported methods are DPA, DPU, and CF-DPU. Preparation writes Parquet tables; completed GSEA input may contain CBOR artifacts, but the served browser package does not. The browser does not contact UniProt, STRING, or AlphaFold for data.
