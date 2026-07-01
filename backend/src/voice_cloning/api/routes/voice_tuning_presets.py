from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from ...services.user_tuning_presets import UserTuningPresetError, UserTuningPresetService
from ..serializers import user_tuning_preset_list_payload, user_tuning_preset_payload


class VoiceTuningPresetRequest(BaseModel):
    id: str | None = None
    name: str
    providerId: str
    voicePresetId: str | None = None
    settings: dict[str, Any]


def create_voice_tuning_presets_router(service: UserTuningPresetService | None) -> APIRouter:
    router = APIRouter()

    @router.get("/api/voice-tuning-presets")
    def list_voice_tuning_presets() -> dict[str, object]:
        preset_service = _require_service(service)
        return user_tuning_preset_list_payload(preset_service.list_presets().presets)

    @router.post("/api/voice-tuning-presets", status_code=status.HTTP_201_CREATED)
    def create_voice_tuning_preset(request: VoiceTuningPresetRequest) -> dict[str, object]:
        preset_service = _require_service(service)
        try:
            preset = preset_service.create_preset(
                preset_id=request.id,
                name=request.name,
                provider_id=request.providerId,
                voice_preset_id=request.voicePresetId,
                settings=request.settings,
            )
        except UserTuningPresetError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return {"preset": user_tuning_preset_payload(preset)}

    @router.put("/api/voice-tuning-presets/{preset_id}")
    def update_voice_tuning_preset(preset_id: str, request: VoiceTuningPresetRequest) -> dict[str, object]:
        preset_service = _require_service(service)
        if request.id is not None and request.id != preset_id:
            raise HTTPException(status_code=422, detail="Voice tuning preset id must match the path id.")
        try:
            preset = preset_service.update_preset(
                preset_id,
                name=request.name,
                provider_id=request.providerId,
                voice_preset_id=request.voicePresetId,
                settings=request.settings,
            )
        except UserTuningPresetError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return {"preset": user_tuning_preset_payload(preset)}

    @router.delete("/api/voice-tuning-presets/{preset_id}")
    def delete_voice_tuning_preset(preset_id: str) -> dict[str, object]:
        preset_service = _require_service(service)
        try:
            deleted = preset_service.delete_preset(preset_id)
        except UserTuningPresetError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return {"deleted": deleted}

    return router


def _require_service(service: UserTuningPresetService | None) -> UserTuningPresetService:
    if service is None:
        raise HTTPException(status_code=503, detail="Voice tuning preset persistence is not configured.")
    return service
