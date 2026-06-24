from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import FileResponse

from ...providers import ProviderError, ProviderRegistry, VOICE_PROVIDER_KEY_HEADER
from ...services.speech_audio import SPEECH_RESULT_CONTENT_TYPE
from ...services.speech_jobs import SpeechJobSegmentInput, SpeechJobService, SpeechJobServiceError
from ..schemas import CreateSpeechJobRequest, RegenerateSpeechSegmentRequest
from ..serializers import speech_job_payload


def create_speech_jobs_router(
    provider_registry: ProviderRegistry,
    speech_jobs: SpeechJobService,
) -> APIRouter:
    router = APIRouter()

    @router.post("/api/speech/jobs", status_code=202)
    async def create_speech_job(
        request: CreateSpeechJobRequest,
        provider_key: str | None = Header(default=None, alias=VOICE_PROVIDER_KEY_HEADER),
    ) -> dict[str, object]:
        try:
            provider = provider_registry.get(request.providerId)
            job = await speech_jobs.create_job(
                text=request.text,
                default_voice_id=request.defaultVoiceId,
                provider=provider,
                provider_key=provider_key,
                model_id=request.modelId,
                segment_gap_ms=request.segmentGapMs,
                voice_settings=request.voiceSettings,
                segments=tuple(
                    SpeechJobSegmentInput(
                        client_segment_id=segment.clientSegmentId,
                        text=segment.text,
                        voice_id=segment.voiceId,
                        assignment_kind=segment.assignmentKind,
                        voice_settings=segment.voiceSettings,
                    )
                    for segment in request.segments
                ),
            )
        except ProviderError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        except SpeechJobServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return {"job": speech_job_payload(job)}

    @router.get("/api/speech/jobs/{job_id}")
    def speech_job(job_id: str) -> dict[str, object]:
        try:
            job = speech_jobs.get_job(job_id)
        except SpeechJobServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return {"job": speech_job_payload(job)}

    @router.post("/api/speech/jobs/{job_id}/cancel")
    async def cancel_speech_job(job_id: str) -> dict[str, object]:
        try:
            job = await speech_jobs.cancel_job(job_id)
        except SpeechJobServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return {"job": speech_job_payload(job)}

    @router.get("/api/speech/jobs/{job_id}/result")
    def speech_job_result(job_id: str) -> FileResponse:
        try:
            path = speech_jobs.result_path(job_id)
        except SpeechJobServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return FileResponse(path, filename=path.name, media_type=SPEECH_RESULT_CONTENT_TYPE)

    @router.get("/api/speech/jobs/{job_id}/segments/{segment_id}/result")
    def speech_job_segment_result(job_id: str, segment_id: str) -> FileResponse:
        try:
            path = speech_jobs.segment_result_path(job_id, segment_id)
        except SpeechJobServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return FileResponse(path, filename=path.name, media_type="audio/mpeg")

    @router.post("/api/speech/jobs/{job_id}/segments/{segment_id}/regenerate", status_code=202)
    async def regenerate_speech_job_segment(
        job_id: str,
        segment_id: str,
        request: RegenerateSpeechSegmentRequest,
        provider_key: str | None = Header(default=None, alias=VOICE_PROVIDER_KEY_HEADER),
    ) -> dict[str, object]:
        try:
            existing_job = speech_jobs.get_job(job_id)
            provider = provider_registry.get(existing_job.provider_id)
            job = await speech_jobs.regenerate_segment(
                job_id,
                segment_id,
                provider=provider,
                provider_key=provider_key,
                voice_id=request.voiceId,
                voice_settings=request.voiceSettings,
            )
        except ProviderError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        except SpeechJobServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return {"job": speech_job_payload(job)}

    return router
