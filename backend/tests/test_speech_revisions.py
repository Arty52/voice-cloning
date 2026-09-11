from __future__ import annotations

import asyncio
from dataclasses import replace
from pathlib import Path

import pytest

from test_api import FakeElevenLabsProvider, make_settings
from voice_cloning.cache import VoiceCache
from voice_cloning.services.speech_jobs import SpeechJobService, SpeechJobServiceError, SpeechJobSegmentInput
from voice_cloning.services.speech_revisions import SpeechSegmentReplacement
from voice_cloning.voice_library import VoiceLibrary


class FakeAssembly:
    def __init__(self):
        self.calls = []
        self.fail = False

    async def concatenate(self, paths, output, *, segment_gap_ms):
        self.calls.append((paths, segment_gap_ms))
        if self.fail:
            raise RuntimeError("Assembly failed")
        output.write_bytes(b"|".join(path.read_bytes() for path in paths))


def make_service(tmp_path):
    settings = make_settings(tmp_path)
    provider = FakeElevenLabsProvider().bind_settings(settings)
    original_speech = provider.create_speech

    async def create_speech(voice_id, text, *args, **kwargs):
        result = await original_speech(voice_id, text, *args, **kwargs)
        return replace(result, audio=text.encode(), character_count=len(text))

    provider.create_speech = create_speech
    assembly = FakeAssembly()
    service = SpeechJobService(settings, VoiceCache(settings.storage_dir / "voice-cache.json"), VoiceLibrary(settings), assembly)
    return service, provider, assembly


async def generate_base(service, provider, count=16):
    inputs = tuple(SpeechJobSegmentInput(client_segment_id=f"row-{i}", text=f"Line {i}.\n", voice_id="default", assignment_kind="assigned") for i in range(count))
    job = await service.create_job(text="".join(s.text for s in inputs), default_voice_id="default", segments=inputs,
                                   provider=provider, provider_key=None, model_id=None, segment_gap_ms=0, voice_settings={"speed": 1.0})
    await service._tasks[job.id]
    assert service.get_job(job.id).status == "success"
    return service.get_job(job.id)


def replacement(index=3, text="Changed line.\n"):
    return SpeechSegmentReplacement(f"row-{index}", text, "default", {"speed": 1.1})


def test_revision_generates_one_of_sixteen_rows_and_preserves_base(tmp_path: Path):
    async def scenario():
        service, provider, assembly = make_service(tmp_path)
        base = await generate_base(service, provider)
        original = service.result_path(base.id).read_bytes()
        revised = await service.create_revision(base.id, replacements=(replacement(),), provider=provider, provider_key=None)
        await service._tasks[revised.id]
        result = service.get_job(revised.id)
        assert result.status == "success"
        assert result.id != base.id
        assert len(provider.speech_requests) == 17
        assert len(assembly.calls) == 2
        assert result.text == "".join(s.text for s in result.segments)
        assert result.segments[3].text == "Changed line.\n"
        assert result.segments[3].generation_count == 2
        for index in range(16):
            if index != 3:
                assert result.segments[index] == base.segments[index]
                assert service.segment_result_path(result.id, f"row-{index}").read_bytes() == service.segment_result_path(base.id, f"row-{index}").read_bytes()
        assert service.get_job(base.id) == base
        assert service.result_path(base.id).read_bytes() == original
    asyncio.run(scenario())


def test_multiple_replacements_and_spacing_only_revision(tmp_path: Path):
    async def scenario():
        service, provider, assembly = make_service(tmp_path)
        base = await generate_base(service, provider, 3)
        revised = await service.create_revision(base.id, replacements=(replacement(0), replacement(2)), provider=provider, provider_key=None)
        await service._tasks[revised.id]
        assert len(provider.speech_requests) == 5
        spacing = await service.create_revision(revised.id, replacements=(), provider=provider, provider_key=None, segment_gap_ms=500)
        await service._tasks[spacing.id]
        assert len(provider.speech_requests) == 5
        assert len(assembly.calls) == 3
        assert assembly.calls[-1][1] == 500
    asyncio.run(scenario())


@pytest.mark.parametrize("changes", [(replacement(99),), (replacement(0), replacement(0)), (replacement(0, "  "),), (replacement(0, "x" * 5001),)])
def test_invalid_revision_does_not_create_files_or_call_provider(tmp_path: Path, changes):
    async def scenario():
        service, provider, assembly = make_service(tmp_path)
        base = await generate_base(service, provider, 2)
        with pytest.raises(SpeechJobServiceError):
            await service.create_revision(base.id, replacements=changes, provider=provider, provider_key=None)
        assert len(provider.speech_requests) == 2
        assert len(list(service.jobs_dir.iterdir())) == 1
    asyncio.run(scenario())


def test_revision_api_contract_and_key_privacy(tmp_path):
    from fastapi.testclient import TestClient
    from voice_cloning.api import create_app
    from voice_cloning.providers import ProviderRegistry, VOICE_PROVIDER_KEY_HEADER
    from test_api import wait_for_speech_job
    service, provider, _ = make_service(tmp_path)
    app = create_app(settings=service.settings, provider_registry=ProviderRegistry([provider]),
                     voice_cache=service.voice_cache, voice_library=service.voice_library, speech_job_service=service)
    with TestClient(app) as client:
        base = client.post("/api/speech/jobs", json={"text": "Hello", "defaultVoiceId": "default", "segments": [
            {"clientSegmentId": "row-0", "text": "Hello", "voiceId": "default"}
        ]}).json()["job"]
        wait_for_speech_job(client, base["id"])
        response = client.post(f"/api/speech/jobs/{base['id']}/revisions", json={"segments": [
            {"segmentId": "row-0", "text": "Goodbye", "voiceId": "default", "voiceSettings": {"speed": 1.1}}
        ]}, headers={VOICE_PROVIDER_KEY_HEADER: "browser-secret"})
        assert response.status_code == 202
        assert "browser-secret" not in response.text
        revised = wait_for_speech_job(client, response.json()["job"]["id"])
        assert revised["text"] == "Goodbye"
        assert revised["segments"][0]["characterCount"] == 7
        assert revised["providerId"] == base["providerId"]
        assert client.get(f"/api/speech/jobs/{base['id']}").json()["job"]["text"] == "Hello"
        assert client.post(f"/api/speech/jobs/{base['id']}/revisions", json={"segments": [], "segmentGapMs": -1}).status_code == 422
        assert client.post("/api/speech/jobs/missing/revisions", json={"segments": []}).status_code == 404
