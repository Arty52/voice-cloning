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
