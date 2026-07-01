from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON, TypeEngine

from .database import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _json_document() -> TypeEngine[Any]:
    return JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql")


class VoiceRecord(Base):
    __tablename__ = "voices"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(String(255), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    sample_mode: Mapped[str] = mapped_column(String(32), default="excerpt", nullable=False)
    window_start_seconds: Mapped[float | None] = mapped_column(Float)
    window_duration_seconds: Mapped[float | None] = mapped_column(Float)
    source_file_path: Mapped[str | None] = mapped_column(Text)
    source_content_type: Mapped[str | None] = mapped_column(String(255))
    source_sha256: Mapped[str | None] = mapped_column(String(64))
    voice_preset_id: Mapped[str] = mapped_column(String(64), default="standardNarration", nullable=False)
    voice_settings_by_provider: Mapped[dict[str, Any]] = mapped_column(_json_document(), default=dict, nullable=False)


class VoiceProcessingStepRecord(Base):
    __tablename__ = "voice_processing_steps"

    voice_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey("voices.id", ondelete="CASCADE"),
        primary_key=True,
    )
    step_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    operation_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    result_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    engine: Mapped[str | None] = mapped_column(String(64))
    processing_preset_id: Mapped[str | None] = mapped_column(String(64))
    processing_preset_label: Mapped[str | None] = mapped_column(String(255))
    speaker_id: Mapped[str | None] = mapped_column(String(128))
    speaker_label: Mapped[str | None] = mapped_column(String(255))


class VoiceLibraryStateRecord(Base):
    __tablename__ = "voice_library_state"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    default_voice_id: Mapped[str | None] = mapped_column(ForeignKey("voices.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class VoiceTuningPresetRecord(Base):
    __tablename__ = "voice_tuning_presets"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    provider_id: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    voice_preset_id: Mapped[str | None] = mapped_column(String(64))
    settings: Mapped[dict[str, Any]] = mapped_column(_json_document(), default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class GeneratedAudioRecord(Base):
    __tablename__ = "generated_audio"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    cache_state: Mapped[str | None] = mapped_column(String(32))
    provider_id: Mapped[str] = mapped_column(String(64), default="elevenlabs", nullable=False)
    provider_voice_id: Mapped[str | None] = mapped_column(String(255))
    app_voice_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("voices.id", ondelete="SET NULL"))
    voice_name: Mapped[str | None] = mapped_column(String(255))
    model_id: Mapped[str | None] = mapped_column(String(255))
    character_count: Mapped[int | None] = mapped_column(Integer)
    request_id: Mapped[str | None] = mapped_column(String(255))
    generation_elapsed_ms: Mapped[int | None] = mapped_column(Integer)
    multi_voice_metadata: Mapped[dict[str, Any] | None] = mapped_column(_json_document())
    tuning_metadata: Mapped[dict[str, Any] | None] = mapped_column(_json_document())


class AppSettingRecord(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[dict[str, Any]] = mapped_column(_json_document(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class SampleProcessingJobRecord(Base):
    __tablename__ = "sample_processing_jobs"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    source_voice_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("voices.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    request_payload: Mapped[dict[str, Any]] = mapped_column(_json_document(), default=dict, nullable=False)
    result_payload: Mapped[dict[str, Any] | None] = mapped_column(_json_document())
    error_message: Mapped[str | None] = mapped_column(Text)


class SpeechGenerationJobRecord(Base):
    __tablename__ = "speech_generation_jobs"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    provider_id: Mapped[str] = mapped_column(String(64), default="elevenlabs", nullable=False)
    result_audio_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("generated_audio.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    request_payload: Mapped[dict[str, Any]] = mapped_column(_json_document(), default=dict, nullable=False)
    result_payload: Mapped[dict[str, Any] | None] = mapped_column(_json_document())
    error_message: Mapped[str | None] = mapped_column(Text)


Index("ix_voices_created_at", VoiceRecord.created_at)
Index("ix_voices_sha256", VoiceRecord.sha256)
Index("ix_voice_processing_steps_voice_position", VoiceProcessingStepRecord.voice_id, VoiceProcessingStepRecord.position)
Index("ix_voice_tuning_presets_provider", VoiceTuningPresetRecord.provider_id)
Index("ix_generated_audio_created_at", GeneratedAudioRecord.created_at)
Index("ix_generated_audio_sha256", GeneratedAudioRecord.sha256)
Index("ix_sample_processing_jobs_created_at", SampleProcessingJobRecord.created_at)
Index("ix_sample_processing_jobs_status", SampleProcessingJobRecord.status)
Index("ix_speech_generation_jobs_created_at", SpeechGenerationJobRecord.created_at)
Index("ix_speech_generation_jobs_status", SpeechGenerationJobRecord.status)
