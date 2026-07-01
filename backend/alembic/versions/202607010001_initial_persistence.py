"""initial persistence schema

Revision ID: 202607010001
Revises:
Create Date: 2026-07-01 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "202607010001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "voices",
        sa.Column("id", sa.String(length=128), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("sample_mode", sa.String(length=32), server_default=sa.text("'excerpt'"), nullable=False),
        sa.Column("window_start_seconds", sa.Float(), nullable=True),
        sa.Column("window_duration_seconds", sa.Float(), nullable=True),
        sa.Column("source_file_path", sa.Text(), nullable=True),
        sa.Column("source_content_type", sa.String(length=255), nullable=True),
        sa.Column("source_sha256", sa.String(length=64), nullable=True),
        sa.Column("voice_preset_id", sa.String(length=64), server_default=sa.text("'standardNarration'"), nullable=False),
        sa.Column(
            "voice_settings_by_provider",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.create_index("ix_voices_created_at", "voices", ["created_at"])
    op.create_index("ix_voices_sha256", "voices", ["sha256"])

    op.create_table(
        "voice_processing_steps",
        sa.Column("voice_id", sa.String(length=128), nullable=False),
        sa.Column("step_id", sa.String(length=128), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("operation_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source_sha256", sa.String(length=64), nullable=False),
        sa.Column("result_sha256", sa.String(length=64), nullable=False),
        sa.Column("engine", sa.String(length=64), nullable=True),
        sa.Column("processing_preset_id", sa.String(length=64), nullable=True),
        sa.Column("processing_preset_label", sa.String(length=255), nullable=True),
        sa.Column("speaker_id", sa.String(length=128), nullable=True),
        sa.Column("speaker_label", sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(["voice_id"], ["voices.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("voice_id", "step_id"),
    )
    op.create_index("ix_voice_processing_steps_voice_position", "voice_processing_steps", ["voice_id", "position"])

    op.create_table(
        "voice_library_state",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("default_voice_id", sa.String(length=128), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["default_voice_id"], ["voices.id"], ondelete="SET NULL"),
    )

    op.create_table(
        "voice_tuning_presets",
        sa.Column("id", sa.String(length=128), primary_key=True),
        sa.Column("provider_id", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("voice_preset_id", sa.String(length=64), nullable=True),
        sa.Column("settings", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_voice_tuning_presets_provider", "voice_tuning_presets", ["provider_id"])

    op.create_table(
        "generated_audio",
        sa.Column("id", sa.String(length=128), primary_key=True),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("cache_state", sa.String(length=32), nullable=True),
        sa.Column("provider_id", sa.String(length=64), server_default=sa.text("'elevenlabs'"), nullable=False),
        sa.Column("provider_voice_id", sa.String(length=255), nullable=True),
        sa.Column("app_voice_id", sa.String(length=128), nullable=True),
        sa.Column("voice_name", sa.String(length=255), nullable=True),
        sa.Column("model_id", sa.String(length=255), nullable=True),
        sa.Column("character_count", sa.Integer(), nullable=True),
        sa.Column("request_id", sa.String(length=255), nullable=True),
        sa.Column("generation_elapsed_ms", sa.Integer(), nullable=True),
        sa.Column("multi_voice_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("tuning_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(["app_voice_id"], ["voices.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_generated_audio_created_at", "generated_audio", ["created_at"])
    op.create_index("ix_generated_audio_sha256", "generated_audio", ["sha256"])

    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=128), primary_key=True),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )

    op.create_table(
        "sample_processing_jobs",
        sa.Column("id", sa.String(length=128), primary_key=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("source_voice_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("request_payload", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("result_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["source_voice_id"], ["voices.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_sample_processing_jobs_created_at", "sample_processing_jobs", ["created_at"])
    op.create_index("ix_sample_processing_jobs_status", "sample_processing_jobs", ["status"])

    op.create_table(
        "speech_generation_jobs",
        sa.Column("id", sa.String(length=128), primary_key=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("provider_id", sa.String(length=64), server_default=sa.text("'elevenlabs'"), nullable=False),
        sa.Column("result_audio_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("request_payload", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("result_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["result_audio_id"], ["generated_audio.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_speech_generation_jobs_created_at", "speech_generation_jobs", ["created_at"])
    op.create_index("ix_speech_generation_jobs_status", "speech_generation_jobs", ["status"])


def downgrade() -> None:
    op.drop_index("ix_speech_generation_jobs_status", table_name="speech_generation_jobs")
    op.drop_index("ix_speech_generation_jobs_created_at", table_name="speech_generation_jobs")
    op.drop_table("speech_generation_jobs")
    op.drop_index("ix_sample_processing_jobs_status", table_name="sample_processing_jobs")
    op.drop_index("ix_sample_processing_jobs_created_at", table_name="sample_processing_jobs")
    op.drop_table("sample_processing_jobs")
    op.drop_table("app_settings")
    op.drop_index("ix_generated_audio_sha256", table_name="generated_audio")
    op.drop_index("ix_generated_audio_created_at", table_name="generated_audio")
    op.drop_table("generated_audio")
    op.drop_index("ix_voice_tuning_presets_provider", table_name="voice_tuning_presets")
    op.drop_table("voice_tuning_presets")
    op.drop_table("voice_library_state")
    op.drop_index("ix_voice_processing_steps_voice_position", table_name="voice_processing_steps")
    op.drop_table("voice_processing_steps")
    op.drop_index("ix_voices_sha256", table_name="voices")
    op.drop_index("ix_voices_created_at", table_name="voices")
    op.drop_table("voices")
