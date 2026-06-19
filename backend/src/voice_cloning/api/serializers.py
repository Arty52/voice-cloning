from __future__ import annotations

from fastapi.responses import Response

from ..models import (
    CachedVoice,
    ModelSummary,
    SampleProcessingJob,
    SampleProcessingOperation,
    SampleProcessingPreset,
    SampleProcessingResult,
    SubscriptionSummary,
    VoiceAsset,
    VoicePreset,
    VoiceProcessingStep,
    VoiceSample,
    VOICE_PRESETS,
)
from ..providers import (
    ProviderDescriptor,
    ProviderTuningControl,
    ProviderTuningMetadata,
    ProviderTuningPreset,
)


def audio_response(
    audio: bytes,
    sample: VoiceSample,
    cached_voice: CachedVoice,
    cache_state: str,
    app_voice_id: str,
    model_id: str,
    character_count: int | None,
    request_id: str | None,
) -> Response:
    headers = {
        "Content-Disposition": 'attachment; filename="voice-clone.mp3"',
        "X-App-Voice-Id": app_voice_id,
        "X-Sample-Sha256": sample.sha256,
        "X-Voice-Cache": cache_state,
        "X-Voice-Id": cached_voice.voice_id,
        "X-Model-Id": model_id,
    }
    if character_count is not None:
        headers["X-Character-Count"] = str(character_count)
    if request_id:
        headers["X-Request-Id"] = request_id
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers=headers,
    )


def subscription_payload(summary: SubscriptionSummary) -> dict[str, object]:
    return {
        "available": True,
        "error": None,
        "tier": summary.tier,
        "status": summary.status,
        "characterCount": summary.character_count,
        "characterLimit": summary.character_limit,
        "remainingCharacters": summary.remaining_characters,
        "canExtendCharacterLimit": summary.can_extend_character_limit,
        "maxCreditLimitExtension": summary.max_credit_limit_extension,
        "nextCharacterCountResetUnix": summary.next_character_count_reset_unix,
    }


def subscription_error_payload(error: str) -> dict[str, object]:
    return {
        "available": False,
        "error": error,
        "tier": "unknown",
        "status": "unavailable",
        "characterCount": 0,
        "characterLimit": 0,
        "remainingCharacters": 0,
        "canExtendCharacterLimit": False,
        "maxCreditLimitExtension": None,
        "nextCharacterCountResetUnix": None,
    }


def models_error_payload(default_model_id: str, error: str) -> dict[str, object]:
    return {
        "available": False,
        "error": error,
        "defaultModelId": default_model_id,
        "models": [],
    }


def providers_payload(
    default_provider_id: str,
    providers: list[ProviderDescriptor],
    server_key_configured_by_provider: dict[str, bool],
) -> dict[str, object]:
    return {
        "defaultProviderId": default_provider_id,
        "voicePresets": [voice_preset_payload(preset) for preset in VOICE_PRESETS],
        "providers": [
            {
                "id": provider.id,
                "label": provider.label,
                "serverKeyConfigured": server_key_configured_by_provider.get(provider.id, False),
                "manageKeyUrl": provider.manage_key_url,
                "docsUrl": provider.docs_url,
                "links": [{"label": link.label, "href": link.href} for link in provider.links],
                "tuning": tuning_payload(provider.tuning),
                "sample": {
                    "maxWindowSeconds": provider.sample.max_window_seconds,
                    "recommendedMinSeconds": provider.sample.recommended_min_seconds,
                    "recommendedMaxSeconds": provider.sample.recommended_max_seconds,
                },
            }
            for provider in providers
        ],
    }


def voice_preset_payload(preset: VoicePreset) -> dict[str, object]:
    return {
        "id": preset.id,
        "label": preset.label,
        "description": preset.description,
    }


def model_payload(model: ModelSummary) -> dict[str, object]:
    return {
        "modelId": model.model_id,
        "name": model.name,
        "description": model.description,
        "canUseStyle": model.can_use_style,
        "canUseSpeakerBoost": model.can_use_speaker_boost,
        "characterCostMultiplier": model.character_cost_multiplier,
        "maxCharactersRequestFreeUser": model.max_characters_request_free_user,
        "maxCharactersRequestSubscribedUser": model.max_characters_request_subscribed_user,
        "maximumTextLengthPerRequest": model.maximum_text_length_per_request,
    }


def voice_asset_payload(asset: VoiceAsset) -> dict[str, object]:
    return {
        "id": asset.id,
        "name": asset.name,
        "filePath": asset.file_path,
        "contentType": asset.content_type,
        "sha256": asset.sha256,
        "source": asset.source,
        "createdAt": asset.created_at,
        "sampleMode": asset.sample_mode,
        "windowStartSeconds": asset.window_start_seconds,
        "windowDurationSeconds": asset.window_duration_seconds,
        "sourceFilePath": asset.source_file_path,
        "sourceContentType": asset.source_content_type,
        "sourceSha256": asset.source_sha256,
        "voicePresetId": asset.voice_preset_id,
        "processingSteps": [voice_processing_step_payload(step) for step in asset.processing_steps],
    }


def voice_processing_step_payload(step: VoiceProcessingStep) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": step.id,
        "label": step.label,
        "operationId": step.operation_id,
        "createdAt": step.created_at,
        "sourceSha256": step.source_sha256,
        "resultSha256": step.result_sha256,
        "engine": step.engine,
    }
    if step.processing_preset_id is not None:
        payload["processingPresetId"] = step.processing_preset_id
        payload["processingPresetLabel"] = step.processing_preset_label
    return payload


def sample_processing_options_payload(
    operations: tuple[SampleProcessingOperation, ...],
) -> dict[str, object]:
    return {
        "operations": [sample_processing_operation_payload(operation) for operation in operations],
    }


def sample_processing_operation_payload(operation: SampleProcessingOperation) -> dict[str, object]:
    return {
        "id": operation.id,
        "label": operation.label,
        "description": operation.description,
        "enabled": operation.enabled,
        "processingPresets": [sample_processing_preset_payload(preset) for preset in operation.processing_presets],
        "defaultProcessingPresetId": operation.default_processing_preset_id,
    }


def sample_processing_preset_payload(preset: SampleProcessingPreset) -> dict[str, object]:
    return {
        "id": preset.id,
        "label": preset.label,
        "description": preset.description,
    }


def sample_processing_job_payload(job: SampleProcessingJob) -> dict[str, object]:
    return {
        "id": job.id,
        "operationId": job.operation_id,
        "status": job.status,
        "processingPresetId": job.processing_preset_id,
        "processingPresetLabel": job.processing_preset_label,
        "sourceName": job.source_name,
        "sourceFilename": job.source_filename,
        "sourceContentType": job.source_content_type,
        "sourceSha256": job.source_sha256,
        "sourcePreference": job.source_preference,
        "createdAt": job.created_at,
        "updatedAt": job.updated_at,
        "error": job.error,
        "engine": job.engine,
        "result": sample_processing_result_payload(job.result) if job.result is not None else None,
    }


def sample_processing_result_payload(result: SampleProcessingResult) -> dict[str, object]:
    return {
        "path": result.path,
        "filename": result.filename,
        "contentType": result.content_type,
        "sha256": result.sha256,
    }


def tuning_payload(tuning: ProviderTuningMetadata) -> dict[str, object]:
    return {
        "controls": [tuning_control_payload(control) for control in tuning.controls],
        "presets": [tuning_preset_payload(preset) for preset in tuning.presets],
        "defaultValues": tuning.resolved_default_values(),
    }


def tuning_control_payload(control: ProviderTuningControl) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": control.id,
        "label": control.label,
        "description": control.description,
        "type": control.type,
        "defaultValue": control.default_value,
    }
    if control.min_value is not None:
        payload["min"] = control.min_value
    if control.max_value is not None:
        payload["max"] = control.max_value
    if control.step is not None:
        payload["step"] = control.step
    if control.options:
        payload["options"] = [{"label": option.label, "value": option.value} for option in control.options]
    if control.capability:
        payload["capability"] = control.capability
    return payload


def tuning_preset_payload(preset: ProviderTuningPreset) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": preset.id,
        "label": preset.label,
        "description": preset.description,
        "values": dict(preset.values),
    }
    if preset.voice_preset_id is not None:
        payload["voicePresetId"] = preset.voice_preset_id
    return payload
