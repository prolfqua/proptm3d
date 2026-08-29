"""Serialize app payloads to disk as JSON or CBOR.

The question every writer answers is: how does one payload become bytes at a path,
and under which file suffix? The format decision is made once, at the composition
root, via :func:`payload_writer_for`; everything downstream holds a
:class:`PayloadWriter` and never branches on a format name. The browser apps pick
their decoder from the file extension the writer produced.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Protocol

import cbor2


class PayloadWriter(Protocol):
    """Writes one JSON-serializable payload to disk in a concrete format."""

    suffix: str

    def write(self, payload: dict[str, Any], base_path: Path) -> Path:
        """Write the payload to ``base_path`` plus this writer's suffix."""
        ...


class JsonPayloadWriter:
    """Writes payloads as plain JSON (``.json``)."""

    suffix = ".json"

    def write(self, payload: dict[str, Any], base_path: Path) -> Path:
        """Write the payload as JSON next to ``base_path``.

        Args:
            payload: JSON-serializable payload.
            base_path: Destination path without a suffix.

        Returns:
            The path of the written ``.json`` file.
        """
        path = base_path.parent / (base_path.name + self.suffix)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path


class CborPayloadWriter:
    """Writes payloads as CBOR (``.cbor``), decoded in the browser by cbor-x."""

    suffix = ".cbor"

    def write(self, payload: dict[str, Any], base_path: Path) -> Path:
        """Write the payload as CBOR next to ``base_path``.

        Args:
            payload: JSON-serializable payload.
            base_path: Destination path without a suffix.

        Returns:
            The path of the written ``.cbor`` file.
        """
        path = base_path.parent / (base_path.name + self.suffix)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(cbor2.dumps(payload))
        return path


_WRITERS: dict[str, type[JsonPayloadWriter] | type[CborPayloadWriter]] = {
    "json": JsonPayloadWriter,
    "cbor": CborPayloadWriter,
}


def payload_writer_for(format_name: str) -> PayloadWriter:
    """Construct the payload writer for a format name.

    Args:
        format_name: ``"json"`` or ``"cbor"``.

    Returns:
        The writer for that format.

    Raises:
        ValueError: The format name is not registered.
    """
    writer_cls = _WRITERS.get(format_name)
    if writer_cls is None:
        message = f"Unknown payload format: {format_name!r} (expected one of {sorted(_WRITERS)})"
        raise ValueError(message)
    return writer_cls()
