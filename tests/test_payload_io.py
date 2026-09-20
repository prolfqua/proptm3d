"""Tests for the JSON/CBOR payload writers and their factory."""

import json

import cbor2
import pytest

from proptm3d import payload_io

PAYLOAD = {"gene_name": "MAPK1", "ptms": [{"res_num": 2, "log2fc": 1.5, "plddt": None}]}


def test_json_writer_round_trip(tmp_path):
    writer = payload_io.JsonPayloadWriter()

    path = writer.write(PAYLOAD, tmp_path / "data" / "MAPK1_P28482")

    assert path == tmp_path / "data" / "MAPK1_P28482.json"
    assert json.loads(path.read_text(encoding="utf-8")) == PAYLOAD


def test_cbor_writer_round_trip(tmp_path):
    writer = payload_io.CborPayloadWriter()

    path = writer.write(PAYLOAD, tmp_path / "data" / "MAPK1_P28482")

    assert path == tmp_path / "data" / "MAPK1_P28482.cbor"
    assert cbor2.loads(path.read_bytes()) == PAYLOAD


def test_payload_writer_factory():
    assert isinstance(payload_io.payload_writer_for("json"), payload_io.JsonPayloadWriter)
    assert isinstance(payload_io.payload_writer_for("cbor"), payload_io.CborPayloadWriter)
    with pytest.raises(ValueError, match="Unknown payload format"):
        payload_io.payload_writer_for("parquet")
