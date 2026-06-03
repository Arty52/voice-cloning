from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ...voice_library import VoiceLibrary
from ..schemas import DefaultVoiceRequest, RenameVoiceRequest
from ..serializers import voice_asset_payload


def create_voices_router(voice_library: VoiceLibrary) -> APIRouter:
    router = APIRouter()

    @router.get("/api/samples/default")
    def default_sample() -> FileResponse:
        return _voice_sample_response(voice_library, voice_library.default_voice_id())

    @router.get("/api/voices")
    def voices() -> dict[str, object]:
        return voice_library.list_payload()

    @router.get("/api/voices/{voice_id}/sample")
    def voice_sample(voice_id: str) -> FileResponse:
        return _voice_sample_response(voice_library, voice_id)

    @router.post("/api/voices", status_code=201)
    async def add_voice(
        name: str = Form(...),
        sampleFile: UploadFile = File(...),
        sampleMode: str = Form("excerpt"),
        sourceFile: UploadFile | None = File(None),
        windowStartSeconds: float | None = Form(None),
        windowDurationSeconds: float | None = Form(None),
    ) -> dict[str, object]:
        asset = await voice_library.add_upload(
            name,
            sampleFile,
            sample_mode=sampleMode,
            source_upload=sourceFile,
            window_start_seconds=windowStartSeconds,
            window_duration_seconds=windowDurationSeconds,
        )
        return {"voice": voice_asset_payload(asset)}

    @router.patch("/api/voices/{voice_id}")
    def rename_voice(voice_id: str, request: RenameVoiceRequest) -> dict[str, object]:
        return voice_library.rename_asset(voice_id, request.name)

    @router.delete("/api/voices/{voice_id}")
    def delete_voice(voice_id: str) -> dict[str, object]:
        return voice_library.delete_asset(voice_id)

    @router.put("/api/voices/default")
    def set_default_voice(request: DefaultVoiceRequest) -> dict[str, object]:
        return voice_library.set_default(request.voiceId)

    return router


def _voice_sample_response(voice_library: VoiceLibrary, voice_id: str) -> FileResponse:
    asset = voice_library.get_asset(voice_id)
    path = voice_library.resolve_asset_path(asset)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Voice sample is missing.")
    return FileResponse(path, filename=path.name, media_type=asset.content_type)
