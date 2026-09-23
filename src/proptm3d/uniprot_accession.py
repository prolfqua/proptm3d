"""Parse UniProt accessions from protein identifiers."""

from __future__ import annotations

import math
import re

_UNIPROT_IN_HEADER = re.compile(r"(?:sp|tr)\|([A-Z0-9]{6,10}(?:-\d+)?)\|")
_UNIPROT_DIRECT = re.compile(r"^[A-Z0-9]{6,10}(?:-\d+)?$")


def parse_uniprot_accession(protein_str: object) -> str | None:
    """Extract a clean UniProt accession from a protein identifier.

    Args:
        protein_str: Identifier such as ``sp|O14974|MYPT1_HUMAN`` or ``O14974``.

    Returns:
        The bare accession, or ``None`` when the input is missing.
    """
    if protein_str is None or (isinstance(protein_str, float) and math.isnan(protein_str)):
        return None
    text = str(protein_str).strip()
    match = _UNIPROT_IN_HEADER.search(text)
    if match:
        return match.group(1)
    if _UNIPROT_DIRECT.match(text):
        return text
    parts = text.split("|")
    if len(parts) >= 2:
        return parts[1]
    return text
