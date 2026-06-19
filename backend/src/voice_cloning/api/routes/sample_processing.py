from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ...services.sample_processing import SampleProcessingService, SampleProcessingServiceError
from ..schemas import SaveProcessedVoiceRequest
from ..serializers import (
    sample_processing_job_payload,
    sample_processing_options_payload,
    voice_asset_payload,
)


def create_sample_processing_router(sample_processing: SampleProcessingService) -> APIRouter:
    router = APIRouter()

    @router.get("/api/sample-processing/options")
    def sample_processing_options() -> dict[str, object]:
        return sample_processing_options_payload(sample_processing.operations())

    @router.post("/api/sample-processing/jobs", status_code=202)
    async def create_sample_processing_job(
        operationId: str = Form(...),
        sourceVoiceId: str | None = Form(None),
        sourcePreference: str = Form("original"),
        sourceFile: UploadFile | None = File(None),
    ) -> dict[str, object]:
        try:
            job = await sample_processing.create_job(
                operation_id=operationId,
                source_voice_id=sourceVoiceId,
                source_preference=sourcePreference,
                source_upload=sourceFile,
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

    @router.get("/api/sample-processing/jobs/{job_id}/result")
    def sample_processing_result(job_id: str) -> FileResponse:
        try:
            job = sample_processing.get_job(job_id)
            path = sample_processing.result_path(job_id)
        except SampleProcessingServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        media_type = job.result.content_type if job.result else "audio/wav"
        return FileResponse(path, filename=path.name, media_type=media_type)

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

    return router
