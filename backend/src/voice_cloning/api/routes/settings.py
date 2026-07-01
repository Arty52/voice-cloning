from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...services.app_settings import AppSettingsError, AppSettingsService


class AppSettingsUpdateRequest(BaseModel):
    settings: dict[str, Any]


def create_settings_router(service: AppSettingsService | None) -> APIRouter:
    router = APIRouter()

    @router.get("/api/settings")
    def get_settings() -> dict[str, object]:
        settings_service = _require_service(service)
        return _settings_payload(settings_service.get_settings().settings)

    @router.put("/api/settings")
    def update_settings(request: AppSettingsUpdateRequest) -> dict[str, object]:
        settings_service = _require_service(service)
        try:
            return _settings_payload(settings_service.update_settings(request.settings).settings)
        except AppSettingsError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return router


def _require_service(service: AppSettingsService | None) -> AppSettingsService:
    if service is None:
        raise HTTPException(status_code=503, detail="App settings persistence is not configured.")
    return service


def _settings_payload(settings: dict[str, dict[str, Any]]) -> dict[str, object]:
    return {
        "available": True,
        "settings": settings,
    }
