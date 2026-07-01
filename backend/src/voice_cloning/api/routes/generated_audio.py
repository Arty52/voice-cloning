from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ...services.generated_audio_archive import (
    GeneratedAudioArchiveError,
    GeneratedAudioArchiveService,
    parse_optional_json_object,
)
from ..serializers import (
    generated_audio_list_payload,
    generated_audio_mutation_payload,
    generated_audio_save_payload,
    generated_audio_usage_payload,
)


class GeneratedAudioStorageLimitRequest(BaseModel):
    limitBytes: int
    prune: bool = True


def create_generated_audio_router(service: GeneratedAudioArchiveService | None) -> APIRouter:
    router = APIRouter()

    @router.get("/api/generated-audio")
    def list_generated_audio() -> dict[str, object]:
        archive = _require_service(service)
        items, usage = archive.list_items()
        return generated_audio_list_payload(items, usage)

    @router.post("/api/generated-audio")
    async def save_generated_audio(
        audioFile: Annotated[UploadFile, File()],
        id: str = Form(...),
        createdAt: str | None = Form(None),
        cacheState: str | None = Form(None),
        providerId: str | None = Form(None),
        voiceId: str | None = Form(None),
        appVoiceId: str | None = Form(None),
        voiceName: str | None = Form(None),
        modelId: str | None = Form(None),
        characterCount: int | None = Form(None),
        requestId: str | None = Form(None),
        generationElapsedMs: int | None = Form(None),
        multiVoiceMetadata: str | None = Form(None),
        tuningMetadata: str | None = Form(None),
    ) -> dict[str, object]:
        archive = _require_service(service)
        try:
            result = await archive.save_upload(
                audio_id=id,
                upload=audioFile,
                created_at=createdAt,
                cache_state=cacheState,
                provider_id=providerId,
                provider_voice_id=voiceId,
                app_voice_id=appVoiceId,
                voice_name=voiceName,
                model_id=modelId,
                character_count=characterCount,
                request_id=requestId,
                generation_elapsed_ms=generationElapsedMs,
                multi_voice_metadata=parse_optional_json_object(multiVoiceMetadata, "multiVoiceMetadata"),
                tuning_metadata=parse_optional_json_object(tuningMetadata, "tuningMetadata"),
            )
        except GeneratedAudioArchiveError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return generated_audio_save_payload(result)

    @router.get("/api/generated-audio/usage")
    def generated_audio_usage() -> dict[str, object]:
        archive = _require_service(service)
        return generated_audio_usage_payload(archive.get_usage())

    @router.put("/api/generated-audio/storage-limit")
    def update_generated_audio_storage_limit(request: GeneratedAudioStorageLimitRequest) -> dict[str, object]:
        archive = _require_service(service)
        try:
            result = archive.update_storage_limit(request.limitBytes, prune=request.prune)
        except GeneratedAudioArchiveError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return generated_audio_mutation_payload(result)

    @router.get("/api/generated-audio/{audio_id}/audio")
    def stream_generated_audio(audio_id: str) -> FileResponse:
        archive = _require_service(service)
        try:
            item = archive.get_item(audio_id)
            path = archive.resolve_audio_path(item)
        except GeneratedAudioArchiveError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        if not path.exists():
            raise HTTPException(status_code=404, detail="Generated audio file is missing.")
        return FileResponse(
            path,
            media_type=item.content_type,
            filename=f"{item.id}{path.suffix or '.mp3'}",
        )

    @router.delete("/api/generated-audio/{audio_id}")
    def delete_generated_audio(audio_id: str) -> dict[str, object]:
        archive = _require_service(service)
        try:
            return generated_audio_mutation_payload(archive.delete(audio_id))
        except GeneratedAudioArchiveError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    @router.delete("/api/generated-audio")
    def clear_generated_audio() -> dict[str, object]:
        archive = _require_service(service)
        return generated_audio_mutation_payload(archive.clear())

    return router


def _require_service(service: GeneratedAudioArchiveService | None) -> GeneratedAudioArchiveService:
    if service is None:
        raise HTTPException(status_code=503, detail="Generated audio archive persistence is not configured.")
    return service
