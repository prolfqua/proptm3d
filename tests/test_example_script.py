"""Smoke-test the order-specific fish prepare/bundle example without touching its data."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "examples" / "o43037_prepare_bundle.fish"
ANALYSIS = Path.home() / "data_analysis" / "o43037_FP24_AntjePhospho"


def test_fish_example_uses_all_method_cli_and_literal_paths():
    lines = [
        line.strip()
        for line in SCRIPT.read_text().splitlines()
        if line.strip() and not line.startswith("#")
    ]
    assert lines == [
        "proptm3d prepare stats ~/data_analysis/o43037_FP24_AntjePhospho/output_3d "
        "--input ~/data_analysis/o43037_FP24_AntjePhospho/"
        "PTM_HIF2a_mutant_vs_GFP_control/PTM_statistics.h5mu",
        "or exit 1",
        "proptm3d bundle --in ~/data_analysis/o43037_FP24_AntjePhospho/output_3d "
        "--out ~/data_analysis/o43037_FP24_AntjePhospho/proptm3d-all.zip",
    ]


@pytest.mark.skipif(shutil.which("fish") is None, reason="fish is not installed")
@pytest.mark.parametrize("fail_prepare", [False, True])
def test_fish_example_invokes_cli_and_stops_after_prepare_failure(tmp_path, fail_prepare):
    executable = tmp_path / "proptm3d"
    executable.write_text(
        '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PROPTM3D_TEST_LOG"\n'
        'if [ "$1" = prepare ] && [ "$PROPTM3D_TEST_FAIL_PREPARE" = 1 ]; then exit 7; fi\n'
    )
    executable.chmod(0o755)
    log = tmp_path / "calls.log"
    env = os.environ.copy()
    env["PATH"] = f"{tmp_path}{os.pathsep}{env['PATH']}"
    env["PROPTM3D_TEST_LOG"] = str(log)
    env["PROPTM3D_TEST_FAIL_PREPARE"] = "1" if fail_prepare else "0"
    subprocess.run(["fish", "--no-config", "-n", str(SCRIPT)], check=True)
    result = subprocess.run(["fish", "--no-config", str(SCRIPT)], env=env, check=False)

    expected = [
        f"prepare stats {ANALYSIS / 'output_3d'} --input "
        f"{ANALYSIS / 'PTM_HIF2a_mutant_vs_GFP_control' / 'PTM_statistics.h5mu'}"
    ]
    if not fail_prepare:
        expected.append(
            f"bundle --in {ANALYSIS / 'output_3d'} --out {ANALYSIS / 'proptm3d-all.zip'}"
        )
    assert log.read_text().splitlines() == expected
    assert result.returncode == (1 if fail_prepare else 0)
