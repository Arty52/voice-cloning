from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ...providers import ProviderError, ProviderRegistry
from ...services.voice_ingestion import VoiceIngestionService, VoiceIngestionServiceError
from ...voice_library import VoiceLibrary
from ..schemas import DefaultVoiceRequest, VoiceUpdateRequest
from ..serializers import voice_asset_payload


def create_voices_router(
    voice_library: VoiceLibrary,
    provider_registry: ProviderRegistry,
    voice_ingestion: VoiceIngestionService,
) -> APIRouter:
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
        voicePresetId: str | None = Form(None),
    ) -> dict[str, object]:
        try:
            asset = await voice_ingestion.add_upload(
                name=name,
                sample_upload=sampleFile,
                sample_mode=sampleMode,
                source_upload=sourceFile,
                window_start_seconds=windowStartSeconds,
                window_duration_seconds=windowDurationSeconds,
                voice_preset_id=voicePresetId,
            )
        except VoiceIngestionServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return {"voice": voice_asset_payload(asset)}

    @router.patch("/api/voices/{voice_id}")
    def update_voice(voice_id: str, request: VoiceUpdateRequest) -> dict[str, object]:
        normalized_voice_settings: dict[str, object] | None = None
        if "voiceSettings" in request.model_fields_set:
            if request.voiceSettings is None:
                raise HTTPException(status_code=422, detail="Voice settings are required.")
            if not request.providerId or not request.providerId.strip():
                raise HTTPException(status_code=422, detail="Provider id is required to save voice settings.")
            try:
                provider = provider_registry.get(request.providerId)
                normalized_voice_settings = provider.normalize_voice_settings(request.voiceSettings)
            except ProviderError as exc:
                raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

        return voice_library.update_asset(
            voice_id,
            name=request.name,
            provider_id=request.providerId,
            voice_preset_id=request.voicePresetId,
            voice_settings=normalized_voice_settings,
        )

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
