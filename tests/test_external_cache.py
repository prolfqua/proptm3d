"""Tests for reusable UniProt and AlphaFold external-data caches."""

import gzip
import io
import json
import tarfile
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock

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
        self.raw = type("RawResponse", (io.BytesIO,), {})(content)
        self.raw.decode_content = True

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


def test_alphafold_archive_can_extract_every_model_without_accession_selection(tmp_path):
    proteome = uniprot_cache.Proteome("UP000000589", 10090, "10090_MOUSE")
    archive_url = alphafold_cache.ARCHIVE_ROOT + "/" + alphafold_cache.archive_name(proteome)
    session = Session(
        {
            archive_url: Response(content=_tar_bytes()),
            alphafold_cache.PREDICTION_ROOT + "/P12345": Response(
                [
                    {"modelEntityId": "AF-P12345-F1", "uniprotStart": 1},
                    {"modelEntityId": "AF-P12345-F2", "uniprotStart": 201},
                ]
            ),
        }
    )

    models = alphafold_cache.cache_archive_models(proteome, tmp_path, session)

    assert set(models) == {"P12345", "Q12345"}
    assert sum(len(entries) for entries in models.values()) == 3
    assert models["P12345"][1]["start"] == 201


def test_alphafold_clean_removes_only_selected_proteome_cache(tmp_path):
    proteome = uniprot_cache.Proteome("UP000000589", 10090, "10090_MOUSE")
    archive_url = alphafold_cache.ARCHIVE_ROOT + "/" + alphafold_cache.archive_name(proteome)
    session = Session(
        {
            archive_url: Response(content=_tar_bytes()),
            alphafold_cache.PREDICTION_ROOT + "/P12345": Response(
                [
                    {"modelEntityId": "AF-P12345-F1", "uniprotStart": 1},
                    {"modelEntityId": "AF-P12345-F2", "uniprotStart": 201},
                ]
            ),
        }
    )
    models = alphafold_cache.cache_archive_models(proteome, tmp_path, session)
    alphafold_root = tmp_path / "alphafold"
    for entries in models.values():
        for model in entries:
            pae = (
                alphafold_root
                / "pae"
                / (f"{model['model_id']}-predicted_aligned_error_v{model['version']}.json.gz")
            )
            pae.parent.mkdir(parents=True, exist_ok=True)
            pae.write_bytes(b"pae")
            context = (
                alphafold_root
                / "structural_context"
                / "bludau-v1"
                / f"{model['model_id']}-model_v{model['version']}.parquet"
            )
            context.parent.mkdir(parents=True, exist_ok=True)
            context.write_bytes(b"context")
    unrelated = alphafold_root / "structures" / "AF-X99999-F1-model_v6.cif.gz"
    unrelated.write_bytes(b"keep")

    summary = alphafold_cache.clean_proteome_cache(proteome, tmp_path)

    assert summary["models"] == 3
    assert unrelated.read_bytes() == b"keep"
    assert not alphafold_cache.archive_catalog_path(tmp_path, proteome).exists()
    assert not any((alphafold_root / "pae").glob("AF-P12345-*.json.gz"))
    assert not any((alphafold_root / "structural_context").glob("*/AF-P12345-*.parquet"))


def test_alphafold_missing_prediction_is_empty(tmp_path):
    session = Session({alphafold_cache.PREDICTION_ROOT + "/X12345": Response(status=404)})
    metadata_dir = tmp_path / "metadata"
    assert alphafold_cache._individual_models({"X12345"}, tmp_path, metadata_dir, session) == {
        "X12345": []
    }
    assert alphafold_cache._individual_models({"X12345"}, tmp_path, metadata_dir, Session({})) == {
        "X12345": []
    }


def test_alphafold_pae_download_and_cache_reuse(tmp_path):
    pae_url = "https://example.org/AF-P12345-F1-pae.json"
    payload = gzip.compress(json.dumps([{"predicted_aligned_error": [[0, 1], [2, 0]]}]).encode())
    models = {
        "P12345": [
            {
                "file": "AF-P12345-F1-model_v6.cif.gz",
                "model_id": "AF-P12345-F1",
                "fragment": 1,
                "version": 6,
                "pae_url": pae_url,
            }
        ]
    }
    response = Response(content=payload, headers={"Content-Encoding": "gzip"})
    session = Session({pae_url: response})

    cached = alphafold_cache.cache_pae_files(models, tmp_path, session)

    path = cached["AF-P12345-F1-model_v6.cif.gz"]
    assert path.read_bytes() == payload
    assert response.raw.decode_content is False
    assert json.loads(gzip.decompress(path.read_bytes()))[0]["predicted_aligned_error"][1] == [
        2,
        0,
    ]
    session.calls.clear()
    assert alphafold_cache.cache_pae_files(models, tmp_path, session) == cached
    assert session.calls == []


def test_alphafold_pae_downloads_are_parallel_without_injected_session(tmp_path, monkeypatch):
    models = {
        accession: [
            {
                "file": f"AF-{accession}-F1-model_v6.cif.gz",
                "model_id": f"AF-{accession}-F1",
                "fragment": 1,
                "version": 6,
                "pae_url": f"https://example.org/{accession}.json",
            }
        ]
        for accession in ("P12345", "Q12345", "R12345")
    }
    lock = Lock()
    release = Event()
    active = 0
    peak = 0

    def cache(model, cache_dir, session):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
            if active >= 2:
                release.set()
        assert release.wait(5)
        with lock:
            active -= 1
        return cache_dir / f"{model['model_id']}.json.gz"

    monkeypatch.setattr(alphafold_cache, "_cache_pae_file", cache)

    cached = alphafold_cache.cache_pae_files(models, tmp_path)

    assert set(cached) == {
        "AF-P12345-F1-model_v6.cif.gz",
        "AF-Q12345-F1-model_v6.cif.gz",
        "AF-R12345-F1-model_v6.cif.gz",
    }
    assert peak > 1


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
