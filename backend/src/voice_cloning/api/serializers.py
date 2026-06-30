from __future__ import annotations

from fastapi.responses import Response

from ..models import (
    CachedVoice,
    ModelSummary,
    PreparedSampleCandidate,
    PreparedSamplesResult,
    SampleProcessingDurationRange,
    SampleProcessingJob,
    SampleProcessingMediaSource,
    SampleProcessingMediaSourceChapter,
    SampleProcessingProgressPhase,
    SampleProcessingJobStep,
    SampleProcessingJobResult,
    SampleProcessingOperation,
    SampleProcessingPreset,
    SampleProcessingResult,
    SampleProcessingSourceRange,
    SampleProcessingSourceSelection,
    SpeakerSeparationResult,
    SpeakerSeparationSpeaker,
    SpeakerSeparationTranscript,
    SpeakerTranscriptItem,
    SpeechJob,
    SpeechJobSegment,
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
    *,
    max_upload_bytes: int,
    max_source_upload_bytes: int,
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
                    "targetSampleRateHz": provider.sample.target_sample_rate_hz,
                    "maxUploadBytes": max_upload_bytes,
                    "maxSourceUploadBytes": max_source_upload_bytes,
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
        "voiceSettingsByProvider": asset.voice_settings_by_provider,
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
    if step.speaker_id is not None:
        payload["speakerId"] = step.speaker_id
        payload["speakerLabel"] = step.speaker_label
    return payload


def sample_processing_options_payload(
    operations: tuple[SampleProcessingOperation, ...],
    *,
    engine: str | None = None,
    recommended_workflow_order: tuple[str, ...] = (),
) -> dict[str, object]:
    return {
        "engine": engine,
        "operations": [sample_processing_operation_payload(operation) for operation in operations],
        "recommendedWorkflowOrder": list(recommended_workflow_order),
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


def sample_processing_media_source_payload(source: SampleProcessingMediaSource) -> dict[str, object]:
    return {
        "id": source.id,
        "filename": source.filename,
        "contentType": source.content_type,
        "sizeBytes": source.size_bytes,
        "sha256": source.sha256,
        "durationSeconds": source.duration_seconds,
        "sampleRateHz": source.sample_rate_hz,
        "chapters": [sample_processing_media_source_chapter_payload(chapter) for chapter in source.chapters],
        "warnings": list(source.warnings),
    }


def sample_processing_media_source_chapter_payload(
    chapter: SampleProcessingMediaSourceChapter,
) -> dict[str, object]:
    return {
        "id": chapter.id,
        "title": chapter.title,
        "startSeconds": chapter.start_seconds,
        "endSeconds": chapter.end_seconds,
        "durationSeconds": chapter.duration_seconds,
    }


def sample_processing_job_payload(job: SampleProcessingJob) -> dict[str, object]:
    return {
        "id": job.id,
        "operationId": job.operation_id,
        "operationLabel": _job_operation_label(job),
        "status": job.status,
        "processingPresetId": job.processing_preset_id,
        "processingPresetLabel": job.processing_preset_label,
        "sourceName": job.source_name,
        "sourceFilename": job.source_filename,
        "sourceContentType": job.source_content_type,
        "sourceSha256": job.source_sha256,
        "sourceSizeBytes": job.source_size_bytes,
        "sourcePreference": job.source_preference,
        "createdAt": job.created_at,
        "updatedAt": job.updated_at,
        "error": job.error,
        "engine": job.engine,
        "workflowMode": job.workflow_mode,
        "steps": [sample_processing_job_step_payload(step) for step in job.steps],
        "activeStepId": job.active_step_id,
        "estimatedDurationRangeSeconds": (
            sample_processing_duration_range_payload(job.estimated_duration_range_seconds)
            if job.estimated_duration_range_seconds is not None
            else None
        ),
        "progressPhases": [sample_processing_progress_phase_payload(phase) for phase in job.progress_phases],
        "activeProgressPhaseId": job.active_progress_phase_id,
        "sourceSelection": (
            sample_processing_source_selection_payload(job.source_selection)
            if job.source_selection is not None
            else None
        ),
        "result": sample_processing_result_payload(job.result) if job.result is not None else None,
    }


def sample_processing_source_selection_payload(selection: SampleProcessingSourceSelection) -> dict[str, object]:
    return {
        "sourceMediaId": selection.source_media_id,
        "ranges": [sample_processing_source_range_payload(source_range) for source_range in selection.ranges],
    }


def sample_processing_source_range_payload(source_range: SampleProcessingSourceRange) -> dict[str, object]:
    return {
        "startSeconds": source_range.start_seconds,
        "endSeconds": source_range.end_seconds,
        "durationSeconds": source_range.duration_seconds,
        "label": source_range.label,
    }


def sample_processing_duration_range_payload(duration_range: SampleProcessingDurationRange) -> dict[str, object]:
    return {
        "minSeconds": duration_range.min_seconds,
        "maxSeconds": duration_range.max_seconds,
    }


def sample_processing_progress_phase_payload(phase: SampleProcessingProgressPhase) -> dict[str, object]:
    return {
        "id": phase.id,
        "label": phase.label,
        "status": phase.status,
        "startedAt": phase.started_at,
        "completedAt": phase.completed_at,
        "error": phase.error,
        "detail": phase.detail,
    }


def sample_processing_job_step_payload(step: SampleProcessingJobStep) -> dict[str, object]:
    return {
        "id": step.id,
        "operationId": step.operation_id,
        "operationLabel": step.operation_label,
        "status": step.status,
        "engine": step.engine,
        "processingPresetId": step.processing_preset_id,
        "processingPresetLabel": step.processing_preset_label,
        "startedAt": step.started_at,
        "completedAt": step.completed_at,
        "error": step.error,
        "sourceSha256": step.source_sha256,
        "resultSha256": step.result_sha256,
    }


def _job_operation_label(job: SampleProcessingJob) -> str:
    for step in reversed(job.steps):
        if step.operation_id == job.operation_id:
            return step.operation_label
    return job.operation_id


def speech_job_payload(job: SpeechJob) -> dict[str, object]:
    return {
        "id": job.id,
        "status": job.status,
        "text": job.text,
        "defaultVoiceId": job.default_voice_id,
        "segmentGapMs": job.segment_gap_ms,
        "segments": [speech_job_segment_payload(segment) for segment in job.segments],
        "activeSegmentId": job.active_segment_id,
        "resultSha256": job.result_sha256,
        "error": job.error,
        "createdAt": job.created_at,
        "updatedAt": job.updated_at,
    }


def speech_job_segment_payload(segment: SpeechJobSegment) -> dict[str, object]:
    return {
        "id": segment.id,
        "index": segment.index,
        "text": segment.text,
        "voiceId": segment.voice_id,
        "voiceName": segment.voice_name,
        "assignmentKind": segment.assignment_kind,
        "voiceSettings": segment.voice_settings,
        "status": segment.status,
        "generationCount": segment.generation_count,
        "characterCount": segment.character_count,
        "requestId": segment.request_id,
        "cacheState": segment.cache_state,
        "resultSha256": segment.result_sha256,
        "error": segment.error,
    }


def sample_processing_result_payload(result: SampleProcessingJobResult) -> dict[str, object]:
    if isinstance(result, PreparedSamplesResult):
        return prepared_samples_result_payload(result)
    if isinstance(result, SpeakerSeparationResult):
        return speaker_separation_result_payload(result)
    return sample_processing_audio_result_payload(result)


def sample_processing_audio_result_payload(result: SampleProcessingResult) -> dict[str, object]:
    return {
        "path": result.path,
        "filename": result.filename,
        "contentType": result.content_type,
        "sha256": result.sha256,
    }


def speaker_separation_result_payload(result: SpeakerSeparationResult) -> dict[str, object]:
    return {
        "kind": result.kind,
        "speakers": [speaker_separation_speaker_payload(speaker) for speaker in result.speakers],
        "transcript": speaker_separation_transcript_payload(result.transcript),
    }


def speaker_separation_speaker_payload(speaker: SpeakerSeparationSpeaker) -> dict[str, object]:
    return {
        "id": speaker.id,
        "label": speaker.label,
        "assignedName": speaker.assigned_name,
        "transcriptItemIds": list(speaker.transcript_item_ids),
        "result": (
            sample_processing_audio_result_payload(speaker.result)
            if speaker.result is not None
            else None
        ),
    }


def speaker_separation_transcript_payload(transcript: SpeakerSeparationTranscript) -> dict[str, object]:
    return {
        "items": [speaker_transcript_item_payload(item) for item in transcript.items],
    }


def speaker_transcript_item_payload(item: SpeakerTranscriptItem) -> dict[str, object]:
    return {
        "id": item.id,
        "text": item.text,
        "startSeconds": item.start_seconds,
        "endSeconds": item.end_seconds,
        "speakerId": item.speaker_id,
    }


def prepared_samples_result_payload(result: PreparedSamplesResult) -> dict[str, object]:
    return {
        "kind": result.kind,
        "warnings": list(result.warnings),
        "candidates": [prepared_sample_candidate_payload(candidate) for candidate in result.candidates],
    }


def prepared_sample_candidate_payload(candidate: PreparedSampleCandidate) -> dict[str, object]:
    return {
        "candidateId": candidate.candidate_id,
        "rank": candidate.rank,
        "score": candidate.score,
        "speakerId": candidate.speaker_id,
        "speakerLabel": candidate.speaker_label,
        "sourceWindow": {
            "startSeconds": candidate.source_start_seconds,
            "endSeconds": candidate.source_end_seconds,
            "durationSeconds": candidate.duration_seconds,
        },
        "durationSeconds": candidate.duration_seconds,
        "sampleRateHz": candidate.sample_rate_hz,
        "contentType": candidate.content_type,
        "sha256": candidate.sha256,
        "warnings": list(candidate.warnings),
        "result": sample_processing_audio_result_payload(candidate.result),
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
