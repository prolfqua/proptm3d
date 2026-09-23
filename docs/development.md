# Development and documentation

The Python package uses `uv` and a locked `pyproject.toml` environment. The browser app under `web/` is TypeScript/Vite with its own npm lockfile. After cloning, install both sets of dependencies:

```sh
make sync
npm ci --prefix web
```

Build this documentation locally with:

```sh
make docs
```

This runs Sphinx with MyST Markdown, Python autodoc, and the Sphinx Book Theme. The generated site is `docs/_build/html/index.html`. The strict build (`-W --keep-going`) fails on Sphinx warnings. No account or external documentation service is needed to build or read it locally.

Run every CI gate with `make check`. It checks the lockfile, Python formatting and linting, dependency and import boundaries, Python tests with branch coverage, TypeScript checks and tests, the production browser build, this documentation build, and source/wheel distributions. The GitHub Actions workflow runs that gate on Python 3.13 and independently tests the supported minimum Python 3.11. Network calls made by preparation are stubbed in tests; the documentation build does not download remote content.
