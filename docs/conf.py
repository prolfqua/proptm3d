"""Sphinx configuration for the Python package documentation."""

from importlib.metadata import version as package_version

project = "proptm3d"
release = package_version(project)
extensions = ["myst_parser", "sphinx.ext.autodoc", "sphinx.ext.napoleon"]
source_suffix = {".md": "markdown", ".rst": "restructuredtext"}
exclude_patterns = ["_build"]
html_theme = "sphinx_book_theme"
html_title = f"{project} {release}"
html_theme_options = {
    "repository_url": "https://github.com/prolfqua/proptm3d",
    "use_repository_button": True,
}
autodoc_typehints = "description"
napoleon_google_docstring = True
napoleon_numpy_docstring = False
myst_heading_anchors = 3
