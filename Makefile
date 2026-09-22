VENV_BIN := .venv/bin
DIR ?= output_3d
METHOD ?= DPA
INPUT ?= PTM_statistics.h5mu
PORT ?= 8000

.DEFAULT_GOAL := help
.PHONY: help sync format format-check lint deps test test-web build check clean serve example

help:  ## Show developer commands
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

sync:  ## Synchronize the locked development environment
	uv sync --frozen --group dev

format:  ## Format and autofix source and tests
	$(VENV_BIN)/ruff format src tests
	$(VENV_BIN)/ruff check --fix src tests

format-check:  ## Check formatting without changing files
	$(VENV_BIN)/ruff format --check src tests

lint:  ## Run code and import-architecture lint checks
	$(VENV_BIN)/ruff check src tests
	$(VENV_BIN)/lint-imports

deps:  ## Validate dependency declarations
	$(VENV_BIN)/deptry .

test:  ## Run tests with branch coverage
	$(VENV_BIN)/pytest --cov --cov-branch

test-web:  ## Run the browser app's pure-module tests under Node
	@command -v node >/dev/null || { echo "node is required for the browser tests"; exit 1; }
	node --test "tests/web/*.test.mjs"

build:  ## Build and validate source and wheel distributions
	uv build
	$(VENV_BIN)/twine check dist/*

check:  ## Run every merge-blocking quality gate
	uv lock --check
	$(MAKE) format-check lint deps test test-web build

serve:  ## Serve a prepared method (METHOD=DPA DIR=output_3d PORT=8000)
	$(VENV_BIN)/proptm3d serve $(METHOD) --output-dir $(DIR) --port $(PORT)

example:  ## Prepare one method from statistics MuData (INPUT=PTM_statistics.h5mu)
	$(VENV_BIN)/proptm3d prepare $(METHOD) --input $(INPUT) --output-dir $(DIR)

clean:  ## Remove generated build and quality artifacts
	$(VENV_BIN)/python -c "import shutil; [shutil.rmtree(path, ignore_errors=True) for path in ('build', 'dist', '.pytest_cache', '.ruff_cache')]"
