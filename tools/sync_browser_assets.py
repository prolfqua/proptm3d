"""Copy a Vite build into the Python package, or verify its checked-in copy."""

from __future__ import annotations

import argparse
import re
import tomllib
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "web" / "dist"
TARGET = ROOT / "src" / "proptm3d" / "browser_static"
ASSET_NAME = re.compile(r"[A-Za-z0-9._-]+-[A-Za-z0-9_-]+\.(?:js|css)\Z")


def browser_files(folder: Path) -> dict[Path, bytes]:
    """Read the small, fixed browser build layout."""
    paths = (Path("index.html"), Path("favicon.svg"))
    assets = sorted((folder / "assets").iterdir())
    if not assets or any(
        not item.is_file() or not ASSET_NAME.fullmatch(item.name) for item in assets
    ):
        msg = f"Unexpected browser build assets in {folder / 'assets'}"
        raise ValueError(msg)
    return {
        path: (folder / path).read_bytes()
        for path in (*paths, *(Path("assets") / a.name for a in assets))
    }


def main() -> None:
    """Synchronize or compare browser assets after a Vite build."""
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--check-wheel", action="store_true")
    args = parser.parse_args()
    expected = browser_files(SOURCE)
    current = browser_files(TARGET) if TARGET.is_dir() else {}
    if args.check:
        if current != expected:
            msg = "Packaged browser files differ from web/dist; run make package-web"
            raise SystemExit(msg)
        print("Packaged browser files match web/dist")
        return
    if args.check_wheel:
        version = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"]
        wheel = ROOT / "dist" / f"proptm3d-{version}-py3-none-any.whl"
        with ZipFile(wheel) as archive:
            prefix = "proptm3d/browser_static/"
            packaged = {
                Path(name.removeprefix(prefix)): archive.read(name)
                for name in archive.namelist()
                if name.startswith(prefix) and not name.endswith("/")
            }
            server_dir = ROOT / "src" / "proptm3d" / "bundle_server"
            server_files = ("serve.py", "serve.sh", "serve.bat", "overview.html")
            packaged_server = {
                name: archive.read(f"proptm3d/bundle_server/{name}")
                for name in server_files
                if f"proptm3d/bundle_server/{name}" in archive.namelist()
            }
        if packaged != current:
            msg = f"Python wheel does not contain the complete browser app: {wheel}"
            raise SystemExit(msg)
        if packaged_server != {name: (server_dir / name).read_bytes() for name in server_files}:
            msg = f"Python wheel does not contain the bundle server and overview files: {wheel}"
            raise SystemExit(msg)
        print(f"Python wheel contains {len(packaged)} browser files, 3 launchers, and the overview")
        return
    (TARGET / "assets").mkdir(parents=True, exist_ok=True)
    for relative in current.keys() - expected.keys():
        (TARGET / relative).unlink()
    for relative, contents in expected.items():
        (TARGET / relative).write_bytes(contents)
    print(f"Packaged {len(expected)} browser files in {TARGET}")


if __name__ == "__main__":
    main()
