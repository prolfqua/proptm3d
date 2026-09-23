VENV_BIN := .venv/bin
DIR ?= output_3d
METHOD ?= DPA
INPUT ?= PTM_statistics.h5mu
PORT ?= 8000

.DEFAULT_GOAL := help
.PHONY: help sync format format-check lint deps test test-web build-web docs build check clean serve example

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

docs:  ## Build warning-free Python HTML documentation
	$(VENV_BIN)/sphinx-build -b html -W --keep-going docs docs/_build/html

build:  ## Build and validate source and wheel distributions
	uv build
	$(VENV_BIN)/twine check dist/*

check:  ## Run every merge-blocking quality gate
	uv lock --check
	$(MAKE) format-check lint deps test test-web build-web docs build

serve:  ## Serve a prepared method (METHOD=DPA DIR=output_3d PORT=8000)
	$(VENV_BIN)/proptm3d serve $(METHOD) --output-dir $(DIR) --port $(PORT)

example:  ## Prepare one method from statistics MuData (INPUT=PTM_statistics.h5mu)
	$(VENV_BIN)/proptm3d prepare $(METHOD) --input $(INPUT) --output-dir $(DIR)

clean:  ## Remove generated build and quality artifacts
	$(VENV_BIN)/python -c "import shutil; [shutil.rmtree(path, ignore_errors=True) for path in ('build', 'dist', '.pytest_cache', '.ruff_cache')]"
