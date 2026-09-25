"""Packaged app installation fails clearly when build files are incomplete."""

import pytest

from proptm3d import browser_assets


def test_browser_install_requires_built_html_and_assets(tmp_path, monkeypatch):
    source = tmp_path / "browser_static"
    source.mkdir()
    folder = tmp_path / "prepared"
    (folder / "data").mkdir(parents=True)
    monkeypatch.setattr(browser_assets, "files", lambda package: tmp_path)

    with pytest.raises(RuntimeError, match="no built browser app"):
        browser_assets.install_browser_assets(folder)

    (source / "index.html").write_text("<ptm-browser-app></ptm-browser-app>")
    (source / "assets").mkdir()
    with pytest.raises(RuntimeError, match="no browser assets"):
        browser_assets.install_browser_assets(folder)
