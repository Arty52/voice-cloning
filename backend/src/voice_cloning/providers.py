from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from typing import Literal

from .config import Settings


DEFAULT_PROVIDER_ID = "elevenlabs"
VOICE_PROVIDER_KEY_HEADER = "X-Voice-Provider-Key"


@dataclass(frozen=True)
class ProviderDescriptor:
    id: str
    label: str
    manage_key_url: str
    docs_url: str


@dataclass(frozen=True)
class ProviderKeyContext:
    provider_id: str
    api_key: str
    source: Literal["browser", "server"]
    fingerprint: str

    @property
    def cache_namespace(self) -> str:
        return f"{self.provider_id}:{self.fingerprint}"


ELEVENLABS_PROVIDER = ProviderDescriptor(
    id=DEFAULT_PROVIDER_ID,
    label="ElevenLabs",
    manage_key_url="https://elevenlabs.io/app/subscription/api",
    docs_url="https://elevenlabs.io/docs/api-reference/authentication",
)


def provider_descriptors() -> list[ProviderDescriptor]:
    return [ELEVENLABS_PROVIDER]


def resolve_elevenlabs_key(settings: Settings, api_key_override: str | None) -> ProviderKeyContext:
    override = (api_key_override or "").strip()
    if override:
        api_key = override
        source: Literal["browser", "server"] = "browser"
    else:
        api_key = settings.elevenlabs_api_key.strip()
        source = "server"

    if not api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not configured.")

    fingerprint = sha256(api_key.encode("utf-8")).hexdigest()
    return ProviderKeyContext(
        provider_id=ELEVENLABS_PROVIDER.id,
        api_key=api_key,
        source=source,
        fingerprint=fingerprint,
    )
