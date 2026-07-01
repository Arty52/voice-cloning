from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


class FileStoreError(ValueError):
    pass


class FileStore(Protocol):
    root: Path

    def ensure_ready(self) -> None:
        ...

    def resolve_path(self, relative_path: str) -> Path:
        ...


@dataclass(frozen=True)
class LocalFileStore:
    root: Path

    def ensure_ready(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)

    def resolve_path(self, relative_path: str) -> Path:
        if not relative_path or Path(relative_path).is_absolute():
            raise FileStoreError("File store paths must be relative.")
        candidate = (self.root / relative_path).resolve()
        try:
            candidate.relative_to(self.root.resolve())
        except ValueError as exc:
            raise FileStoreError("File store path escapes its configured root.") from exc
        return candidate


def create_generated_audio_file_store(root: Path) -> LocalFileStore:
    return LocalFileStore(root=root.resolve())
