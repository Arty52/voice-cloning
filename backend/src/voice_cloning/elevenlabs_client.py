from __future__ import annotations

from typing import Any

import httpx

from .config import Settings
from .models import ModelSummary, SpeechResult, SubscriptionSummary, VoiceClone, VoiceSample, VoiceSettings


class ElevenLabsError(Exception):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class ElevenLabsClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def get_subscription(self) -> SubscriptionSummary:
        self.settings.require_api_key()
        url = f"{self.settings.elevenlabs_api_base_url}/user/subscription"
        headers = {"xi-api-key": self.settings.elevenlabs_api_key}
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise ElevenLabsError(_public_error(exc.response), status_code=502) from exc
            except httpx.RequestError as exc:
                raise ElevenLabsError("Unable to reach the ElevenLabs API.", status_code=503) from exc

        payload = response.json()
        if not isinstance(payload, dict):
            raise ElevenLabsError("ElevenLabs returned an invalid subscription payload.")
        return _subscription_from_payload(payload)

    async def list_models(self) -> list[ModelSummary]:
        self.settings.require_api_key()
        url = f"{self.settings.elevenlabs_api_base_url}/models"
        headers = {"xi-api-key": self.settings.elevenlabs_api_key}
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise ElevenLabsError(_public_error(exc.response), status_code=502) from exc
            except httpx.RequestError as exc:
                raise ElevenLabsError("Unable to reach the ElevenLabs API.", status_code=503) from exc

        payload = response.json()
        if not isinstance(payload, list):
            raise ElevenLabsError("ElevenLabs returned an invalid models payload.")
        return [_model_from_payload(item) for item in payload if _is_tts_model(item)]

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

    async def create_speech(
        self,
        voice_id: str,
        text: str,
        voice_settings: VoiceSettings | None = None,
        model_id: str | None = None,
    ) -> SpeechResult:
        self.settings.require_api_key()
        url = f"{self.settings.elevenlabs_api_base_url}/text-to-speech/{voice_id}"
        headers = {
            "xi-api-key": self.settings.elevenlabs_api_key,
            "Content-Type": "application/json",
        }
        params = {"output_format": "mp3_44100_128"}
        payload = {
            "text": text,
            "model_id": model_id or self.settings.elevenlabs_model_id,
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
        return SpeechResult(
            audio=response.content,
            character_count=_optional_int_payload(response.headers.get("x-character-count")),
            request_id=_response_request_id(response),
        )


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


def _subscription_from_payload(payload: dict[str, Any]) -> SubscriptionSummary:
    character_count = _int_payload(payload.get("character_count"))
    character_limit = _int_payload(payload.get("character_limit"))
    return SubscriptionSummary(
        tier=_str_payload(payload.get("tier"), "unknown"),
        status=_str_payload(payload.get("status"), "unknown"),
        character_count=character_count,
        character_limit=character_limit,
        remaining_characters=max(character_limit - character_count, 0),
        can_extend_character_limit=bool(payload.get("can_extend_character_limit", False)),
        max_credit_limit_extension=_credit_limit_extension(payload.get("max_credit_limit_extension")),
        next_character_count_reset_unix=_optional_int_payload(payload.get("next_character_count_reset_unix")),
    )


def _is_tts_model(value: Any) -> bool:
    return isinstance(value, dict) and value.get("can_do_text_to_speech") is True


def _model_from_payload(payload: Any) -> ModelSummary:
    if not isinstance(payload, dict):
        raise ElevenLabsError("ElevenLabs returned an invalid model item.")
    rates = payload.get("model_rates")
    rate_multiplier = None
    if isinstance(rates, dict):
        rate_multiplier = _optional_float_payload(rates.get("character_cost_multiplier"))
    if rate_multiplier is None:
        rate_multiplier = _optional_float_payload(payload.get("token_cost_factor"))

    return ModelSummary(
        model_id=_required_str_payload(payload.get("model_id"), "model_id"),
        name=_str_payload(payload.get("name"), "Unnamed model"),
        description=_str_payload(payload.get("description"), ""),
        can_use_style=bool(payload.get("can_use_style", False)),
        can_use_speaker_boost=bool(payload.get("can_use_speaker_boost", False)),
        character_cost_multiplier=rate_multiplier,
        max_characters_request_free_user=_optional_int_payload(payload.get("max_characters_request_free_user")),
        max_characters_request_subscribed_user=_optional_int_payload(
            payload.get("max_characters_request_subscribed_user")
        ),
        maximum_text_length_per_request=_optional_int_payload(payload.get("maximum_text_length_per_request")),
    )


def _required_str_payload(value: Any, field_name: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    raise ElevenLabsError(f"ElevenLabs returned a model without {field_name}.")


def _str_payload(value: Any, fallback: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback


def _int_payload(value: Any) -> int:
    parsed = _optional_int_payload(value)
    return parsed if parsed is not None else 0


def _optional_int_payload(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value)
    return None


def _optional_float_payload(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _credit_limit_extension(value: Any) -> int | str | None:
    if value == "unlimited":
        return "unlimited"
    return _optional_int_payload(value)


def _response_request_id(response: httpx.Response) -> str | None:
    for header in ("x-request-id", "request-id"):
        value = response.headers.get(header)
        if value:
            return value
    return None
