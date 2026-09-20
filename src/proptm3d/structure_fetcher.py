"""Fetch and cache 3D protein structure models from AlphaFold DB."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import requests
from loguru import logger

DEFAULT_CACHE_DIR = Path.home() / ".cache" / "proptm3d"

_API_TIMEOUT_SECONDS = 15
_DOWNLOAD_TIMEOUT_SECONDS = 30


class StructureFetchError(RuntimeError):
    """Raised when an AlphaFold structure cannot be retrieved."""


def get_alphafold_model_info(uniprot_acc: str) -> dict[str, Any]:
    """Query the AlphaFold DB API for model metadata and download URLs.

    Args:
        uniprot_acc: UniProt accession (isoform suffixes are stripped).

    Returns:
        The first model record returned by the API.

    Raises:
        StructureFetchError: The API request failed or returned no model.
    """
    clean_acc = uniprot_acc.split("-")[0].strip()
    url = f"https://alphafold.ebi.ac.uk/api/prediction/{clean_acc}"
    try:
        resp = requests.get(url, timeout=_API_TIMEOUT_SECONDS)
        resp.raise_for_status()
    except requests.RequestException as error:
        message = f"AlphaFold API request failed for {clean_acc}: {error}"
        raise StructureFetchError(message) from error
    data = resp.json()
    if not isinstance(data, list) or not data:
        message = f"AlphaFold DB has no model for {clean_acc}"
        raise StructureFetchError(message)
    return data[0]


def fetch_structure(
    uniprot_acc: str,
    cache_dir: Path | str = DEFAULT_CACHE_DIR,
    file_format: str = "pdb",
) -> Path:
    """Download the AlphaFold model for a UniProt accession, using a local cache.

    Args:
        uniprot_acc: UniProt accession (isoform suffixes are stripped).
        cache_dir: Directory holding downloaded structure files.
        file_format: ``"pdb"`` or ``"cif"``.

    Returns:
        Path to the local structure file.

    Raises:
        StructureFetchError: The model metadata or file could not be retrieved.
    """
    cache_path = Path(cache_dir)
    cache_path.mkdir(parents=True, exist_ok=True)
    clean_acc = uniprot_acc.split("-")[0].strip()
    target_file = cache_path / f"{clean_acc}.{file_format}"

    if target_file.exists() and target_file.stat().st_size > 0:
        return target_file

    info = get_alphafold_model_info(clean_acc)
    url_key = "pdbUrl" if file_format == "pdb" else "cifUrl"
    download_url = info.get(url_key)
    if not download_url:
        message = f"No {file_format} URL in AlphaFold DB response for {clean_acc}"
        raise StructureFetchError(message)

    logger.info("Downloading {} structure from {}", clean_acc, download_url)
    try:
        resp = requests.get(download_url, timeout=_DOWNLOAD_TIMEOUT_SECONDS)
        resp.raise_for_status()
    except requests.RequestException as error:
        message = f"Failed to download structure from {download_url}: {error}"
        raise StructureFetchError(message) from error
    target_file.write_text(resp.text, encoding="utf-8")
    return target_file
