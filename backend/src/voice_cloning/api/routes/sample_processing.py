from __future__ import annotations

import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ...services.sample_processing import (
    PreparedCandidateVoiceSelection,
    SampleProcessingWorkflowStepInput,
    SampleProcessingService,
    SampleProcessingServiceError,
    SourceRangeInput,
    SpeakerNameAssignment,
    SpeakerTranscriptAssignment,
    SpeakerVoiceSelection,
)
from ..schemas import (
    SavePreparedCandidateVoicesRequest,
    SaveProcessedVoiceRequest,
    SaveSpeakerVoicesRequest,
    UpdateSpeakerAssignmentsRequest,
)
from ..serializers import (
    sample_processing_job_payload,
    sample_processing_options_payload,
    voice_asset_payload,
)


def create_sample_processing_router(sample_processing: SampleProcessingService) -> APIRouter:
    router = APIRouter()

    @router.get("/api/sample-processing/options")
    def sample_processing_options() -> dict[str, object]:
        return sample_processing_options_payload(
            sample_processing.operations(),
            engine=sample_processing.engine(),
            recommended_workflow_order=sample_processing.recommended_workflow_order(),
        )

    @router.post("/api/sample-processing/jobs", status_code=202)
    async def create_sample_processing_job(
        operationId: str | None = Form(None),
        processingPresetId: str | None = Form(None),
        sourceVoiceId: str | None = Form(None),
        sourcePreference: str = Form("original"),
        sourceMediaId: str | None = Form(None),
        sourceRanges: str | None = Form(None),
        workflowSteps: str | None = Form(None),
        cleanVoice: bool | None = Form(None),
        detectSpeakers: bool | None = Form(None),
        trimCandidates: bool | None = Form(None),
        isolationPresetId: str | None = Form(None),
        trimPresetId: str | None = Form(None),
        sourceFile: UploadFile | None = File(None),
    ) -> dict[str, object]:
        try:
            job = await sample_processing.create_job(
                operation_id=operationId,
                processing_preset_id=processingPresetId,
                source_voice_id=sourceVoiceId,
                source_preference=sourcePreference,
                source_upload=sourceFile,
                source_media_id=sourceMediaId,
                source_ranges=_parse_source_ranges(sourceRanges),
                workflow_steps=_parse_workflow_steps(workflowSteps),
                clean_voice=cleanVoice,
                detect_speakers=detectSpeakers,
                trim_candidates=trimCandidates,
                isolation_preset_id=isolationPresetId,
                trim_preset_id=trimPresetId,
            )
        except SampleProcessingServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return {"job": sample_processing_job_payload(job)}

    @router.get("/api/sample-processing/jobs/{job_id}")
    def sample_processing_job(job_id: str) -> dict[str, object]:
        try:
            job = sample_processing.get_job(job_id)
        except SampleProcessingServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return {"job": sample_processing_job_payload(job)}

    @router.post("/api/sample-processing/jobs/{job_id}/cancel")
    async def cancel_sample_processing_job(job_id: str) -> dict[str, object]:
        try:
            job = await sample_processing.cancel_job(job_id)
        except SampleProcessingServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return {"job": sample_processing_job_payload(job)}

    @router.get("/api/sample-processing/jobs/{job_id}/result")
    def sample_processing_result(job_id: str) -> FileResponse:
        try:
            job = sample_processing.get_job(job_id)
            path = sample_processing.result_path(job_id)
        except SampleProcessingServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        media_type = job.result.content_type if job.result else "audio/wav"
        return FileResponse(path, filename=path.name, media_type=media_type)

    @router.get("/api/sample-processing/jobs/{job_id}/source")
    def sample_processing_source(job_id: str) -> FileResponse:
        try:
            job = sample_processing.get_job(job_id)
            path = sample_processing.source_path(job_id)
        except SampleProcessingServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return FileResponse(path, filename=path.name, media_type=job.source_content_type)

    @router.get("/api/sample-processing/jobs/{job_id}/speakers/{speaker_id}/result")
    def sample_processing_speaker_result(job_id: str, speaker_id: str) -> FileResponse:
        try:
            path = sample_processing.speaker_result_path(job_id, speaker_id)
        except SampleProcessingServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return FileResponse(path, filename=path.name, media_type="audio/wav")

    @router.get("/api/sample-processing/jobs/{job_id}/candidates/{candidate_id}/result")
    def sample_processing_candidate_result(job_id: str, candidate_id: str) -> FileResponse:
        try:
            path = sample_processing.candidate_result_path(job_id, candidate_id)
        except SampleProcessingServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return FileResponse(path, filename=path.name, media_type="audio/wav")

    @router.patch("/api/sample-processing/jobs/{job_id}/speaker-assignments")
    async def update_sample_processing_speaker_assignments(
        job_id: str,
        request: UpdateSpeakerAssignmentsRequest,
    ) -> dict[str, object]:
        try:
            job = await sample_processing.update_speaker_assignments(
                job_id,
                speaker_names=tuple(
                    SpeakerNameAssignment(speaker_id=item.speakerId, name=item.name)
                    for item in request.speakerNames
                ),
                transcript_assignments=tuple(
                    SpeakerTranscriptAssignment(item_id=item.itemId, speaker_id=item.speakerId)
                    for item in request.transcriptAssignments
                ),
            )
        except SampleProcessingServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return {"job": sample_processing_job_payload(job)}

    @router.post("/api/sample-processing/jobs/{job_id}/voice", status_code=201)
    def save_sample_processing_result(job_id: str, request: SaveProcessedVoiceRequest) -> dict[str, object]:
        try:
            voice = sample_processing.save_result_as_voice(
                job_id,
                name=request.name,
                voice_preset_id=request.voicePresetId,
            )
        except SampleProcessingServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return {"voice": voice_asset_payload(voice)}

    @router.post("/api/sample-processing/jobs/{job_id}/speaker-voices", status_code=201)
    def save_sample_processing_speaker_results(job_id: str, request: SaveSpeakerVoicesRequest) -> dict[str, object]:
        try:
            voices = sample_processing.save_speaker_results_as_voices(
                job_id,
                voices=tuple(
                    SpeakerVoiceSelection(
                        speaker_id=item.speakerId,
                        name=item.name,
                        voice_preset_id=item.voicePresetId,
                    )
                    for item in request.voices
                ),
            )
        except SampleProcessingServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return {"voices": [voice_asset_payload(voice) for voice in voices]}

    @router.post("/api/sample-processing/jobs/{job_id}/candidate-voices", status_code=201)
    def save_sample_processing_candidate_results(
        job_id: str,
        request: SavePreparedCandidateVoicesRequest,
    ) -> dict[str, object]:
        try:
            voices = sample_processing.save_candidate_results_as_voices(
                job_id,
                voices=tuple(
                    PreparedCandidateVoiceSelection(
                        candidate_id=item.candidateId,
                        name=item.name,
                        voice_preset_id=item.voicePresetId,
                    )
                    for item in request.voices
                ),
            )
        except SampleProcessingServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return {"voices": [voice_asset_payload(voice) for voice in voices]}

    return router


def _parse_workflow_steps(value: str | None) -> tuple[SampleProcessingWorkflowStepInput, ...] | None:
    if value is None or not value.strip():
        return None
    try:
        raw_steps = json.loads(value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="workflowSteps must be valid JSON.") from exc
    if not isinstance(raw_steps, list):
        raise HTTPException(status_code=422, detail="workflowSteps must be a JSON array.")
    steps: list[SampleProcessingWorkflowStepInput] = []
    for raw_step in raw_steps:
        if not isinstance(raw_step, dict):
            raise HTTPException(status_code=422, detail="workflowSteps entries must be objects.")
        operation_id = raw_step.get("operationId")
        processing_preset_id = raw_step.get("processingPresetId")
        if not isinstance(operation_id, str):
            raise HTTPException(status_code=422, detail="workflowSteps operationId is required.")
        if processing_preset_id is not None and not isinstance(processing_preset_id, str):
            raise HTTPException(status_code=422, detail="workflowSteps processingPresetId must be a string.")
        steps.append(
            SampleProcessingWorkflowStepInput(
                operation_id=operation_id,
                processing_preset_id=processing_preset_id,
            )
        )
    return tuple(steps)


def _parse_source_ranges(value: str | None) -> tuple[SourceRangeInput, ...] | None:
    if value is None or not value.strip():
        return None
    try:
        raw_ranges = json.loads(value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="sourceRanges must be valid JSON.") from exc
    if not isinstance(raw_ranges, list):
        raise HTTPException(status_code=422, detail="sourceRanges must be a JSON array.")
    ranges: list[SourceRangeInput] = []
    for raw_range in raw_ranges:
        if not isinstance(raw_range, dict):
            raise HTTPException(status_code=422, detail="sourceRanges entries must be objects.")
        start_seconds = raw_range.get("startSeconds")
        end_seconds = raw_range.get("endSeconds")
        label = raw_range.get("label")
        if not _is_json_number(start_seconds) or not _is_json_number(end_seconds):
            raise HTTPException(status_code=422, detail="sourceRanges startSeconds and endSeconds are required.")
        if label is not None and not isinstance(label, str):
            raise HTTPException(status_code=422, detail="sourceRanges label must be a string.")
        ranges.append(
            SourceRangeInput(
                start_seconds=float(start_seconds),
                end_seconds=float(end_seconds),
                label=label,
            )
        )
    return tuple(ranges)


def _is_json_number(value: object) -> bool:
    return not isinstance(value, bool) and isinstance(value, int | float)
