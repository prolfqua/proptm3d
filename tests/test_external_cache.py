"""Whole-proteome annotations and AlphaFold archive acquisition stay in prepare."""

import gzip
import io
import tarfile
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import polars as pl
import pytest
import requests

from proptm3d import alphafold_cache, uniprot_cache


class Response:
    def __init__(self, body=None, *, status=200, headers=None, links=None, content=b""):
        self.body = body
        self.status_code = status
        self.headers = headers or {}
        self.links = links or {}
        self.content = content

    def json(self):
        return self.body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise ValueError(f"HTTP {self.status_code}")

    def iter_content(self, chunk_size):
        yield self.content

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class Session:
    def __init__(self, get_routes, post_routes=None):
        self.get_routes = get_routes
        self.post_routes = post_routes or {}
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append(("GET", url))
        return self.get_routes[url]

    def post(self, url, **kwargs):
        self.calls.append(("POST", url))
        return self.post_routes[url]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _entry(accession, *, residue="S", features=True):
    return {
        "primaryAccession": accession,
        "organism": {"taxonId": 10090},
        "sequence": {"value": f"A{residue}AA", "length": 4},
        "features": (
            [
                {
                    "type": "Domain",
                    "description": "Catalytic",
                    "location": {
                        "start": {"value": 2, "modifier": "EXACT"},
                        "end": {"value": 4, "modifier": "LESS_THAN"},
                    },
                    "evidences": [{"evidenceCode": "ECO:0000259", "source": "PROSITE"}],
                }
            ]
            if features
            else []
        ),
    }


def test_uniprot_pages_extra_mapping_and_cache_reuse(tmp_path):
    marker = {"X-UniProt-Release": "2026_03"}
    routes = {
        uniprot_cache.UNIPROT_SEARCH: Response(
            {"results": [_entry("P12345")]},
            headers=marker,
            links={"next": {"url": "page-two"}},
        ),
        "page-two": Response({"results": [_entry("Q12345", features=False)]}, headers=marker),
        uniprot_cache.UNIPROT_MAPPING + "/status/job": Response({"jobStatus": "FINISHED"}),
        uniprot_cache.UNIPROT_MAPPING + "/uniprotkb/results/job": Response(
            {
                "results": [{"from": "X12345", "to": _entry("X12345")}],
            }
        ),
    }
    session = Session(routes, {uniprot_cache.UNIPROT_MAPPING + "/run": Response({"jobId": "job"})})
    annotations = uniprot_cache.load_annotations(
        ["sp|P12345|A_MOUSE", "sp|Q12345|B_MOUSE"],
        {"P12345", "Q12345", "X12345"},
        tmp_path,
        session,
    )
    assert annotations.release == "2026_03"
    assert annotations.primary_accessions == {"P12345", "Q12345"}
    assert set(annotations.proteins["accession"]) == {"P12345", "Q12345", "X12345"}
    assert annotations.features.height == 2
    assert annotations.features["end_modifier"].to_list() == ["LESS_THAN", "LESS_THAN"]
    assert pl.read_parquet(tmp_path / "uniprot" / "UP000000589" / "proteins.parquet").height == 2
    cached_session = Session({})
    cached = uniprot_cache.load_annotations(
        ["sp|P12345|A_MOUSE"], {"P12345", "X12345"}, tmp_path, cached_session
    )
    assert cached.release == "2026_03"
    assert "X12345" in cached.proteins["accession"].to_list()
    assert cached_session.calls == []


def test_uniprot_inference_rejects_ambiguous_species():
    with pytest.raises(ValueError, match="unique"):
        uniprot_cache.infer_proteome(["sp|A|X_MOUSE", "sp|B|X_HUMAN"])
    assert uniprot_cache.infer_proteome(["sp|A|X_HUMAN"]).taxon_id == 9606


def _tar_bytes():
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w") as bundle:
        for name in (
            "AF-P12345-F1-model_v6.cif.gz",
            "AF-P12345-F2-model_v6.cif.gz",
            "AF-Q12345-F1-model_v6.cif.gz",
            "not-a-model.txt",
        ):
            content = gzip.compress(b"data_model\n")
            member = tarfile.TarInfo(name)
            member.size = len(content)
            bundle.addfile(member, io.BytesIO(content))
    return data.getvalue()


def test_alphafold_archive_fragments_foreign_model_and_cache_reuse(tmp_path):
    proteome = uniprot_cache.Proteome("UP000000589", 10090, "10090_MOUSE")
    archive_url = alphafold_cache.ARCHIVE_ROOT + "/" + alphafold_cache.archive_name(proteome)
    routes = {
        archive_url: Response(content=_tar_bytes()),
        alphafold_cache.PREDICTION_ROOT + "/P12345": Response(
            [
                {"modelEntityId": "AF-P12345-F1", "uniprotStart": 1, "uniprotEnd": 1400},
                {"modelEntityId": "AF-P12345-F2", "uniprotStart": 201, "uniprotEnd": 1600},
            ]
        ),
        alphafold_cache.PREDICTION_ROOT + "/X12345": Response(
            [
                {
                    "modelEntityId": "AF-X12345-F1",
                    "cifUrl": "https://example.org/x.cif",
                    "uniprotStart": 1,
                    "uniprotEnd": 12,
                    "latestVersion": 6,
                },
                {"modelEntityId": "AF-X12345-2-F1", "cifUrl": "https://example.org/isoform.cif"},
            ]
        ),
        "https://example.org/x.cif": Response(content=b"data_foreign\n"),
    }
    session = Session(routes)
    models = alphafold_cache.cache_models(
        proteome,
        {"P12345", "Q12345", "X12345"},
        {"P12345", "Q12345"},
        tmp_path,
        session,
    )
    assert [item["start"] for item in models["P12345"]] == [1, 201]
    assert models["P12345"][1]["end"] == 1600
    assert models["Q12345"][0]["fragment"] == 1
    assert models["X12345"][0]["end"] == 12
    assert (
        gzip.decompress(
            (tmp_path / "alphafold" / "structures" / "AF-X12345-F1-individual.cif.gz").read_bytes()
        )
        == b"data_foreign\n"
    )
    assert (
        tmp_path
        / "alphafold"
        / (alphafold_cache.archive_name(proteome).replace(".tar", ".complete.json"))
    ).is_file()
    session.calls.clear()
    alphafold_cache.cache_models(
        proteome,
        {"P12345", "Q12345", "X12345"},
        {"P12345", "Q12345"},
        tmp_path,
        session,
    )
    assert session.calls == []


def test_alphafold_missing_prediction_is_empty(tmp_path):
    session = Session({alphafold_cache.PREDICTION_ROOT + "/X12345": Response(status=404)})
    metadata_dir = tmp_path / "metadata"
    assert alphafold_cache._individual_models({"X12345"}, tmp_path, metadata_dir, session) == {
        "X12345": []
    }
    assert alphafold_cache._individual_models({"X12345"}, tmp_path, metadata_dir, Session({})) == {
        "X12345": []
    }


def test_alphafold_download_resumes_partial_file(tmp_path):
    target = tmp_path / "proteome.tar"
    partial = tmp_path / "proteome.tar.part"
    partial.write_bytes(b"first-")
    session = Session({"https://example.org/proteome.tar": Response(status=206, content=b"second")})
    alphafold_cache._download("https://example.org/proteome.tar", target, session)
    assert target.read_bytes() == b"first-second"
    assert not partial.exists()


def test_alphafold_download_retries_after_interruption(tmp_path, monkeypatch):
    class Interrupted(Response):
        def iter_content(self, chunk_size):
            yield b"first-"
            raise requests.ConnectionError("connection dropped")

    class RetrySession:
        def __init__(self):
            self.responses = [
                Interrupted(content=b"unused"),
                Response(status=206, content=b"second"),
            ]

        def get(self, url, **kwargs):
            return self.responses.pop(0)

    monkeypatch.setattr(alphafold_cache.time, "sleep", lambda delay: None)
    target = tmp_path / "proteome.tar"
    alphafold_cache._download("https://example.org/proteome.tar", target, RetrySession())
    assert target.read_bytes() == b"first-second"


def test_alphafold_download_discards_oversized_partial(tmp_path):
    class RetrySession:
        def __init__(self):
            self.responses = [Response(status=416), Response(content=b"complete")]
            self.ranges = []

        def get(self, url, **kwargs):
            self.ranges.append(kwargs["headers"])
            return self.responses.pop(0)

    target = tmp_path / "proteome.tar"
    target.with_name("proteome.tar.part").write_bytes(b"oversized-corrupt-partial")
    session = RetrySession()
    alphafold_cache._download("https://example.org/proteome.tar", target, session)
    assert target.read_bytes() == b"complete"
    assert session.ranges == [{"Range": "bytes=25-"}, {}]


def test_alphafold_download_resumes_after_short_response(tmp_path, monkeypatch):
    class RetrySession:
        def __init__(self):
            self.responses = [
                Response(content=b"first-", headers={"Content-Length": "12"}),
                Response(status=206, content=b"second", headers={"Content-Length": "6"}),
            ]

        def get(self, url, **kwargs):
            return self.responses.pop(0)

    monkeypatch.setattr(alphafold_cache.time, "sleep", lambda delay: None)
    target = tmp_path / "proteome.tar"
    alphafold_cache._download("https://example.org/proteome.tar", target, RetrySession())
    assert target.read_bytes() == b"first-second"


def test_alphafold_archive_download_is_shared_between_preparations(tmp_path):
    proteome = uniprot_cache.Proteome("UP000000589", 10090, "10090_MOUSE")
    archive_url = alphafold_cache.ARCHIVE_ROOT + "/" + alphafold_cache.archive_name(proteome)
    entered = Event()
    release = Event()

    class SlowSession(Session):
        def get(self, url, **kwargs):
            entered.set()
            assert release.wait(5)
            return super().get(url, **kwargs)

    first_session = SlowSession({archive_url: Response(content=_tar_bytes())})
    second_session = Session({})
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(alphafold_cache._archive, tmp_path, proteome, first_session)
        assert entered.wait(5)
        second = pool.submit(alphafold_cache._archive, tmp_path, proteome, second_session)
        assert not second.done()
        release.set()
        assert first.result(timeout=5) == second.result(timeout=5)
    assert second_session.calls == []
