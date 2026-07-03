"""generated audio script snapshot

Revision ID: 202607010003
Revises: 202607010002
Create Date: 2026-07-01 00:00:02.000000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "202607010003"
down_revision: str | None = "202607010002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "generated_audio",
        sa.Column("script_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("generated_audio", "script_snapshot")
