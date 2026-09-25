"""Render static black-point backgrounds while preparing Parquet data."""

from __future__ import annotations

import json
import math
import struct
import zlib
from pathlib import Path

import polars as pl

WIDTH = 1600
HEIGHT = 640
DOT_RADIUS = 2
DOT_ALPHA = 92
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _padded_range(values: list[float]) -> tuple[float, float]:
    if not values:
        msg = "Cannot render a background without plottable points"
        raise ValueError(msg)
    low = min(0.0, min(values))
    high = max(0.0, max(values))
    padding = max((high - low) * 0.05, 0.1)
    return low - padding, high + padding


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def render_plot_background(
    points: list[tuple[float, float]], width: int = WIDTH, height: int = HEIGHT
) -> tuple[bytes, tuple[float, float], tuple[float, float]]:
    """Draw black RGBA dots with ranges matching the browser's Plotly axes."""
    x_range = _padded_range([x for x, _ in points])
    y_range = _padded_range([y for _, y in points])
    pixels = bytearray(width * height * 4)
    for x, y in points:
        center_x = math.floor((x - x_range[0]) / (x_range[1] - x_range[0]) * (width - 1) + 0.5)
        center_y = math.floor((y_range[1] - y) / (y_range[1] - y_range[0]) * (height - 1) + 0.5)
        for dy in range(-DOT_RADIUS, DOT_RADIUS + 1):
            for dx in range(-DOT_RADIUS, DOT_RADIUS + 1):
                if dx * dx + dy * dy > DOT_RADIUS * DOT_RADIUS:
                    continue
                pixel_x = center_x + dx
                pixel_y = center_y + dy
                if not (0 <= pixel_x < width and 0 <= pixel_y < height):
                    continue
                alpha_index = (pixel_y * width + pixel_x) * 4 + 3
                current = pixels[alpha_index]
                pixels[alpha_index] = current + math.floor(DOT_ALPHA * (1 - current / 255) + 0.5)
    scanlines = b"".join(
        b"\0" + pixels[row * width * 4 : (row + 1) * width * 4] for row in range(height)
    )
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = (
        PNG_SIGNATURE
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(scanlines, level=9))
        + _chunk(b"IEND", b"")
    )
    return png, x_range, y_range


def write_plot_backgrounds(folder: Path, stats: pl.DataFrame, contrasts: list[str]) -> None:
    """Write both black-point images and their axis metadata for each contrast."""
    image_dir = folder / "data" / "plot_backgrounds"
    image_dir.mkdir()
    plots = {}
    for index, contrast in enumerate(contrasts):
        scoped = stats.filter(pl.col("contrast") == contrast)
        volcano = scoped.filter(pl.col("effect").is_finite() & pl.col("fdr").is_finite())
        volcano_points = [
            (effect, -math.log10(max(fdr, 1e-300)))
            for effect, fdr in volcano.select("effect", "fdr").iter_rows()
        ]
        protein_site = scoped.filter(
            pl.col("protein_fc").is_finite() & pl.col("original_site_fc").is_finite()
        )
        protein_site_points = list(
            protein_site.select("protein_fc", "original_site_fc").iter_rows()
        )
        plots[contrast] = {}
        for name, points, filename in (
            ("volcano", volcano_points, f"volcano-{index}.png"),
            ("protein_site", protein_site_points, f"protein-site-{index}.png"),
        ):
            png, x_range, y_range = render_plot_background(points)
            (image_dir / filename).write_bytes(png)
            plots[contrast][name] = {
                "file": f"data/plot_backgrounds/{filename}",
                "x_range": x_range,
                "y_range": y_range,
            }
    (folder / "data" / "plot_backgrounds.json").write_text(
        json.dumps({"schema_version": "1", "plots": plots}, indent=2) + "\n"
    )
