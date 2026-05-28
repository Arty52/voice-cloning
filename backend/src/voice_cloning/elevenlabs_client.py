from __future__ import annotations

from typing import Any

import httpx

from .config import Settings
from .models import VoiceClone, VoiceSample, VoiceSettings


class ElevenLabsError(Exception):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class ElevenLabsClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def create_voice(self, sample: VoiceSample) -> VoiceClone:
        self.settings.require_api_key()
        url = f"{self.settings.elevenlabs_api_base_url}/voices/add"
        headers = {"xi-api-key": self.settings.elevenlabs_api_key}
        data = {
            "name": f"Local clone {sample.sha256[:12]}",
            "description": "Created by the local voice-cloning app.",
            "remove_background_noise": "false",
        }
        files = [
            (
                "files",
                (sample.filename, sample.content, sample.content_type),
            )
        ]
        async with httpx.AsyncClient(timeout=60) as client:
            try:
                response = await client.post(url, headers=headers, data=data, files=files)
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise ElevenLabsError(_public_error(exc.response), status_code=502) from exc
            except httpx.RequestError as exc:
                raise ElevenLabsError("Unable to reach the ElevenLabs API.", status_code=503) from exc

        payload = response.json()
        voice_id = payload.get("voice_id")
        if not isinstance(voice_id, str) or not voice_id:
            raise ElevenLabsError("ElevenLabs did not return a voice ID.")
        return VoiceClone(
            voice_id=voice_id,
            requires_verification=bool(payload.get("requires_verification", False)),
        )

    async def create_speech(self, voice_id: str, text: str, voice_settings: VoiceSettings | None = None) -> bytes:
        self.settings.require_api_key()
        url = f"{self.settings.elevenlabs_api_base_url}/text-to-speech/{voice_id}"
        headers = {
            "xi-api-key": self.settings.elevenlabs_api_key,
            "Content-Type": "application/json",
        }
        params = {"output_format": "mp3_44100_128"}
        payload = {
            "text": text,
            "model_id": self.settings.elevenlabs_model_id,
        }
        if voice_settings is not None:
            payload["voice_settings"] = {
                "stability": voice_settings.stability,
                "similarity_boost": voice_settings.similarity_boost,
                "style": voice_settings.style,
                "speed": voice_settings.speed,
                "use_speaker_boost": voice_settings.use_speaker_boost,
            }
        async with httpx.AsyncClient(timeout=120) as client:
            try:
                response = await client.post(url, headers=headers, params=params, json=payload)
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise ElevenLabsError(_public_error(exc.response), status_code=502) from exc
            except httpx.RequestError as exc:
                raise ElevenLabsError("Unable to reach the ElevenLabs API.", status_code=503) from exc
        return response.content


def _public_error(response: httpx.Response) -> str:
    detail = _extract_detail(response)
    if detail:
        return f"ElevenLabs API returned {response.status_code}: {detail}"
    return f"ElevenLabs API returned {response.status_code}."


def _extract_detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return _truncate(response.text)

    detail = payload.get("detail") if isinstance(payload, dict) else payload
    if isinstance(detail, str):
        return _truncate(detail)
    if isinstance(detail, list):
        messages = []
        for item in detail:
            if isinstance(item, dict) and isinstance(item.get("msg"), str):
                messages.append(item["msg"])
            elif isinstance(item, str):
                messages.append(item)
        return _truncate("; ".join(messages))
    if isinstance(detail, dict):
        message = detail.get("message") or detail.get("status")
        if isinstance(message, str):
            return _truncate(message)
    return ""


def _truncate(value: Any, limit: int = 240) -> str:
    text = str(value).replace("\n", " ").strip()
    return text[:limit]
