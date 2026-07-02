"""generated audio export ledger

Revision ID: 202607010002
Revises: 202607010001
Create Date: 2026-07-01 00:00:01.000000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "202607010002"
down_revision: str | None = "202607010001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "generated_audio_export_ledger",
        sa.Column("target_id", sa.String(length=128), nullable=False),
        sa.Column("audio_id", sa.String(length=128), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("exported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["audio_id"], ["generated_audio.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("target_id", "audio_id", "sha256"),
    )
    op.create_index("ix_generated_audio_export_ledger_audio", "generated_audio_export_ledger", ["audio_id"])
    op.create_index("ix_generated_audio_export_ledger_status", "generated_audio_export_ledger", ["status"])


def downgrade() -> None:
    op.drop_index("ix_generated_audio_export_ledger_status", table_name="generated_audio_export_ledger")
    op.drop_index("ix_generated_audio_export_ledger_audio", table_name="generated_audio_export_ledger")
    op.drop_table("generated_audio_export_ledger")
