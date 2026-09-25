#!/usr/bin/env fish
# Run with proptm3d in the active .venv and the MOUSE context cache prepared.
# Prepares DPA, DPU, and CF-DPU, then bundles all three with server launchers.

proptm3d prepare stats ~/data_analysis/o43037_FP24_AntjePhospho/output_3d --input ~/data_analysis/o43037_FP24_AntjePhospho/PTM_HIF2a_mutant_vs_GFP_control/PTM_statistics.h5mu
or exit 1

proptm3d bundle --in ~/data_analysis/o43037_FP24_AntjePhospho/output_3d --out ~/data_analysis/o43037_FP24_AntjePhospho/proptm3d-all.zip
