"""Tests for parsing protein identifiers into UniProt accessions."""

import pytest

from proptm3d.uniprot_accession import parse_uniprot_accession


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("sp|P28482|MK01_HUMAN", "P28482"),
        ("tr|A0A024R5Z9|A0A024R5Z9_HUMAN", "A0A024R5Z9"),
        ("P28482", "P28482"),
        ("P28482-2", "P28482-2"),
        ("weird|Q12345|rest", "Q12345"),
        ("not-an-accession", "not-an-accession"),
    ],
)
def test_parse_uniprot_accession(value, expected):
    assert parse_uniprot_accession(value) == expected


def test_parse_uniprot_accession_missing_value():
    assert parse_uniprot_accession(None) is None
    assert parse_uniprot_accession(float("nan")) is None
