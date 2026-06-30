from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from ...services.media_sources import (
    MEDIA_SOURCE_PREVIEW_CONTENT_TYPE,
    MEDIA_SOURCE_PREVIEW_MAX_SECONDS,
    MediaSourceServiceError,
    SampleProcessingMediaSourceService,
)
from ..serializers import sample_processing_media_source_payload


def create_sample_processing_sources_router(
    media_sources: SampleProcessingMediaSourceService,
) -> APIRouter:
    router = APIRouter()

    @router.post("/api/sample-processing/sources", status_code=201)
    async def create_sample_processing_source(sourceFile: UploadFile = File(...)) -> dict[str, object]:
        try:
            source = await media_sources.create_source(sourceFile)
        except MediaSourceServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return {"source": sample_processing_media_source_payload(source)}

    @router.get("/api/sample-processing/sources/{source_id}")
    def sample_processing_source(source_id: str) -> dict[str, object]:
        try:
            source = media_sources.get_source(source_id)
        except MediaSourceServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return {"source": sample_processing_media_source_payload(source)}

    @router.get("/api/sample-processing/sources/{source_id}/preview")
    async def sample_processing_source_preview(
        source_id: str,
        startSeconds: float = Query(0),
        durationSeconds: float = Query(MEDIA_SOURCE_PREVIEW_MAX_SECONDS),
    ) -> FileResponse:
        try:
            path = await media_sources.preview_path(source_id, startSeconds, durationSeconds)
        except MediaSourceServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return FileResponse(path, filename=path.name, media_type=MEDIA_SOURCE_PREVIEW_CONTENT_TYPE)

    @router.delete("/api/sample-processing/sources/{source_id}", status_code=204)
    def delete_sample_processing_source(source_id: str) -> None:
        try:
            media_sources.delete_source(source_id)
        except MediaSourceServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return router
