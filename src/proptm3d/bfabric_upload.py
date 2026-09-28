"""Upload PTM Pipeline and proptm3d result artifacts to their B-Fabric applications."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar
from zipfile import BadZipFile, ZipFile

from bfabric import Bfabric
from bfabric.operations.workunit import (
    FileDoneCallback,
    FileProgressCallback,
    UploadFileParam,
    UploadFilesParams,
    UploadStartCallback,
    UploadSummary,
    upload_files,
)

from proptm3d.bundle import validate_bundle
from proptm3d.upload_cache import UploadPair

PTM_PIPELINE_APPLICATION_ID = 431
PROPTM3D_APPLICATION_ID = 434
BFABRIC_CONFIG_ENVIRONMENT = "app-431-ptm-pipeline"


class BundleUploadError(RuntimeError):
    """A bundle transfer that returned without one successful upload."""


class UploadConfigurationError(RuntimeError):
    """A required saved B-Fabric application environment is unavailable."""


@dataclass(frozen=True, slots=True)
class UploadArtifact(ABC):
    """One artifact whose concrete type owns its validation and B-Fabric target."""

    path: Path

    application_id: ClassVar[int]
    application_name: ClassVar[str]
    config_environment: ClassVar[str]

    @abstractmethod
    def validate(self) -> Path:
        """Validate and return the resolved upload path."""


@dataclass(frozen=True, slots=True)
class PtmPipelineArtifact(UploadArtifact):
    """A completed PTM Pipeline delivery uploaded through application 431."""

    application_id: ClassVar[int] = PTM_PIPELINE_APPLICATION_ID
    application_name: ClassVar[str] = "PTM Pipeline"
    config_environment: ClassVar[str] = BFABRIC_CONFIG_ENVIRONMENT

    def validate(self) -> Path:
        """Require a ZIP containing exactly one completed PTM results MuData file."""
        path = _zip_path(self.path, "PTM Pipeline result")
        try:
            with ZipFile(path) as archive:
                results = [
                    member
                    for member in archive.infolist()
                    if not member.is_dir() and Path(member.filename).name == "PTM_results.h5mu"
                ]
        except BadZipFile as error:
            msg = f"Invalid PTM Pipeline result ZIP: {path}"
            raise ValueError(msg) from error
        if len(results) != 1:
            msg = f"Expected exactly one PTM_results.h5mu in {path}; found {len(results)}"
            raise ValueError(msg)
        return path


@dataclass(frozen=True, slots=True)
class Proptm3dArtifact(UploadArtifact):
    """A portable proptm3d browser bundle uploaded through application 434."""

    application_id: ClassVar[int] = PROPTM3D_APPLICATION_ID
    application_name: ClassVar[str] = "proptm3d"
    config_environment: ClassVar[str] = BFABRIC_CONFIG_ENVIRONMENT

    def validate(self) -> Path:
        """Require a valid portable proptm3d bundle."""
        path = _zip_path(self.path, "proptm3d bundle")
        validate_bundle(path)
        return path


@dataclass(frozen=True, slots=True)
class UploadReceipt:
    """A completed upload together with the application that received it."""

    artifact: UploadArtifact
    summary: UploadSummary


@dataclass(frozen=True, slots=True)
class UploadProgressCallbacks:
    """Optional bfabricPy callbacks used to display transfer progress."""

    on_start: UploadStartCallback
    on_progress: FileProgressCallback
    on_file_done: FileDoneCallback


def _zip_path(path: Path, description: str) -> Path:
    resolved = path.resolve()
    if not resolved.is_file():
        msg = f"{description} not found: {resolved}"
        raise FileNotFoundError(msg)
    if resolved.suffix.lower() != ".zip":
        msg = f"{description} must be a ZIP: {resolved}"
        raise ValueError(msg)
    return resolved


def artifacts_for(pair: UploadPair) -> tuple[UploadArtifact, UploadArtifact]:
    """Construct the two concrete upload artifacts for one cached result pair."""
    return PtmPipelineArtifact(pair.pipeline_zip), Proptm3dArtifact(pair.proptm3d_zip)


def _validate_target(order_id: int, workunit_name: str) -> None:
    if order_id <= 0:
        msg = "B-Fabric order ID must be a positive integer"
        raise ValueError(msg)
    if not workunit_name.strip():
        msg = "B-Fabric workunit name must not be empty"
        raise ValueError(msg)


def _upload_file(
    artifact: UploadArtifact,
    path: Path,
    client: Bfabric,
    order_id: int,
    workunit_name: str,
    progress: UploadProgressCallbacks | None,
) -> UploadSummary:
    summary = upload_files(
        client=client,
        params=UploadFilesParams(
            files=[UploadFileParam(path=path)],
            container_id=order_id,
            application_id=artifact.application_id,
            workunit_name=workunit_name,
        ),
        on_start=progress.on_start if progress else None,
        on_progress=progress.on_progress if progress else None,
        on_file_done=progress.on_file_done if progress else None,
    )
    if summary.workunit_id is None:
        msg = f"B-Fabric did not create a {artifact.application_name} workunit"
        raise BundleUploadError(msg)
    if summary.failures:
        failures = "; ".join(f"{failure.filename}: {failure.error}" for failure in summary.failures)
        msg = f"B-Fabric workunit {summary.workunit_id} was created, but upload failed: {failures}"
        raise BundleUploadError(msg)
    if len(summary.uploads) != 1:
        msg = (
            f"B-Fabric workunit {summary.workunit_id} did not report the expected "
            f"{artifact.application_name} transfer"
        )
        raise BundleUploadError(msg)
    return summary


def _connect(artifact: UploadArtifact) -> Bfabric:
    try:
        return Bfabric.connect(config_file_env=artifact.config_environment)
    except KeyError as error:
        msg = (
            f"Missing B-Fabric credentials environment {artifact.config_environment!r} "
            f"for application {artifact.application_id} ({artifact.application_name})"
        )
        raise UploadConfigurationError(msg) from error


def upload_artifacts(
    artifacts: tuple[UploadArtifact, ...],
    order_id: int,
    workunit_name: str,
    *,
    progress: UploadProgressCallbacks | None = None,
) -> tuple[UploadReceipt, ...]:
    """Validate and connect every target before creating any B-Fabric workunit."""
    _validate_target(order_id, workunit_name)
    paths = tuple(artifact.validate() for artifact in artifacts)
    clients = tuple(_connect(artifact) for artifact in artifacts)
    return tuple(
        UploadReceipt(
            artifact,
            _upload_file(artifact, path, client, order_id, workunit_name, progress),
        )
        for artifact, path, client in zip(artifacts, paths, clients, strict=True)
    )


def upload_pair(
    pair: UploadPair,
    order_id: int,
    workunit_name: str,
    *,
    progress: UploadProgressCallbacks | None = None,
) -> tuple[UploadReceipt, ...]:
    """Upload a cached PTM Pipeline/proptm3d pair to their separate applications."""
    return upload_artifacts(artifacts_for(pair), order_id, workunit_name, progress=progress)


def upload_bundle(
    bundle_path: Path,
    order_id: int,
    workunit_name: str,
    *,
    progress: UploadProgressCallbacks | None = None,
) -> UploadSummary:
    """Upload one validated bundle ZIP to a new B-Fabric proptm3d workunit.

    The saved ``app-431-ptm-pipeline`` client-credentials environment in ``~/.bfabricpy.yml``
    is used for application 434. Interrupted transfers use the B-Fabric client's resume cache.
    """
    return upload_artifacts(
        (Proptm3dArtifact(bundle_path),),
        order_id,
        workunit_name,
        progress=progress,
    )[0].summary
