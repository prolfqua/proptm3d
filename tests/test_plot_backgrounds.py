"""Prepared black-point images have the same coordinates as browser plot axes."""

import json
import struct
import zlib

import polars as pl
import pytest

from proptm3d.plot_backgrounds import render_plot_background, write_plot_backgrounds


def _rgba(png, x, y):
    width, height = struct.unpack_from(">II", png, 16)
    assert 0 <= x < width
    assert 0 <= y < height
    assert png[12:16] == b"IHDR"
    compressed_length = struct.unpack_from(">I", png, 33)[0]
    assert png[37:41] == b"IDAT"
    raw = zlib.decompress(png[41 : 41 + compressed_length])
    start = y * (1 + width * 4) + 1 + x * 4
    return tuple(raw[start : start + 4])


def test_python_background_matches_browser_axis_geometry():
    png, x_range, y_range = render_plot_background([(0, 0), (4, 5)], 51, 31)
    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    assert x_range[0] < 0 < 4 < x_range[1]
    assert y_range[0] < 0 < 5 < y_range[1]
    assert _rgba(png, 25, 15) == (0, 0, 0, 0)
    assert _rgba(png, 2, 29)[:3] == (0, 0, 0)
    assert _rgba(png, 2, 29)[3] > 0
    assert _rgba(png, 48, 1)[3] > 0
    assert _rgba(png, 48, 29)[3] == 0


def test_python_background_rejects_empty_series():
    with pytest.raises(ValueError, match="without plottable points"):
        render_plot_background([])


def test_prepare_backgrounds_uses_each_contrast_and_parquet_columns(tmp_path):
    (tmp_path / "data").mkdir()
    stats = pl.DataFrame(
        {
            "contrast": ["first", "first", "second"],
            "effect": [2.0, None, -3.0],
            "fdr": [0.01, None, 0.001],
            "protein_fc": [1.0, None, -1.0],
            "original_site_fc": [2.0, None, -3.0],
        }
    )
    write_plot_backgrounds(tmp_path, stats, ["first", "second"])
    document = json.loads((tmp_path / "data" / "plot_backgrounds.json").read_text())
    assert document["schema_version"] == "1"
    assert set(document["plots"]) == {"first", "second"}
    assert document["plots"]["first"]["volcano"]["file"] == ("data/plot_backgrounds/volcano-0.png")
    assert (tmp_path / "data" / "plot_backgrounds" / "protein-site-1.png").is_file()
