# Third-party notices

The prediction-aware exposure and IDR calculation in
`src/proptm3d/structural_context.py` follows the algorithm implemented by
[MannLabs StructureMap](https://github.com/MannLabs/structuremap):

> Copyright 2020 MannLabs

StructureMap is licensed under the Apache License, Version 2.0. The proptm3d
implementation is modified and independently vectorized for NumPy and Polars;
it retains StructureMap's published distance, angle, PAE, smoothing, and
classification parameters.

The scientific method is described in Isabell Bludau et al., “The structural
context of posttranslational modifications at a proteome-wide scale,” PLOS
Biology 20(5): e3001636 (2022),
<https://doi.org/10.1371/journal.pbio.3001636>.
