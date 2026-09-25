VENV_BIN := .venv/bin
DIR ?=
METHOD ?= DPA
INPUT ?= PTM_statistics.h5mu
PORT ?= 8000

.DEFAULT_GOAL := help
.PHONY: help sync format format-check lint deps test test-web build-web package-web check-browser-assets test-deploy docs build check clean serve example

help:  ## Show developer commands
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

sync:  ## Synchronize the locked development and docs environment
	uv sync --frozen --group dev --group docs

format:  ## Format and autofix source and tests
	$(VENV_BIN)/ruff format src tests docs/conf.py
	$(VENV_BIN)/ruff check --fix src tests docs/conf.py

format-check:  ## Check formatting without changing files
	$(VENV_BIN)/ruff format --check src tests docs/conf.py

lint:  ## Run code and import-architecture lint checks
	$(VENV_BIN)/ruff check src tests docs/conf.py
	$(VENV_BIN)/lint-imports

deps:  ## Validate dependency declarations
	$(VENV_BIN)/deptry .

test:  ## Run tests with branch coverage
	$(VENV_BIN)/pytest --cov --cov-branch

test-web:  ## Type-check and test the TypeScript browser app
	@command -v npm >/dev/null || { echo "npm is required for the browser tests"; exit 1; }
	npm --prefix web run check
	npm --prefix web test

build-web:  ## Build the deployable TypeScript browser app
	npm --prefix web run build

package-web: build-web  ## Update the browser assets included in the Python package
	$(VENV_BIN)/python tools/sync_browser_assets.py

check-browser-assets: build-web  ## Verify bundled browser files match the TypeScript build
	$(VENV_BIN)/python tools/sync_browser_assets.py --check

test-deploy: check-browser-assets  ## Test deployment and bundling against the built browser app
	PROPTM3D_DEPLOY_SMOKE=1 $(VENV_BIN)/pytest -q tests/test_bundle.py::test_browser_deploy_accepts_explicit_prepared_root

docs:  ## Build warning-free Python HTML documentation
	$(VENV_BIN)/sphinx-build -b html -W --keep-going docs docs/_build/html

build:  ## Build and validate source and wheel distributions
	uv build
	$(VENV_BIN)/twine check dist/*
	$(VENV_BIN)/python tools/sync_browser_assets.py --check-wheel

check:  ## Run every merge-blocking quality gate
	uv lock --check
	$(MAKE) format-check lint deps test test-web test-deploy docs build

serve:  ## Serve a prepared method (METHOD=DPA DIR=/path/to/viewer PORT=8000)
	@test -n "$(DIR)" || { echo "Set DIR to a prepared output folder"; exit 1; }
	$(VENV_BIN)/proptm3d serve $(METHOD) $(DIR) --port $(PORT)

example:  ## Prepare one method (DIR=/path/to/viewer INPUT=PTM_statistics.h5mu)
	@test -n "$(DIR)" || { echo "Set DIR to a prepared output folder"; exit 1; }
	$(VENV_BIN)/proptm3d prepare stats $(METHOD) $(DIR) --input $(INPUT)

clean:  ## Remove generated build and quality artifacts
	$(VENV_BIN)/python -c "import shutil; [shutil.rmtree(path, ignore_errors=True) for path in ('build', 'dist', '.pytest_cache', '.ruff_cache')]"
