import json
import os

import pytest

from ncloud_mcp.errors import SafeError
from ncloud_mcp.server import create_server
from ncloud_mcp.speech.config import SpeechConfig


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in os.environ:
        if name.startswith("NCLOUD_SPEECH_"):
            monkeypatch.delenv(name)


def test_disabled_ignores_unrelated_credentials(monkeypatch):
    monkeypatch.setenv("NCLOUD_SPEECH_INVOKE_URL", "invalid")
    config = SpeechConfig.from_env()
    assert not config.enabled
    assert not config.configured


def test_health_and_repr_never_include_secrets_or_paths(tmp_path):
    config = SpeechConfig(
        enabled=True,
        secret="synthetic-secret",
        invoke_url="synthetic-invoke",
        local_roots=(tmp_path,),
    )
    health = json.dumps(config.health())
    for sensitive in (config.secret, config.invoke_url, str(tmp_path)):
        assert sensitive not in health
    assert config.secret not in repr(config)
    assert config.invoke_url not in repr(config)
    assert config.health()["network_check_performed"] is False


@pytest.mark.parametrize(
    "name,value",
    [
        ("NCLOUD_SPEECH_ENABLED", "1"),
        ("NCLOUD_SPEECH_INVOKE_URL", "https://attacker.example/key"),
        ("NCLOUD_SPEECH_INVOKE_URL", "https://clovaspeech-gw.ncloud.com/external/v1/1/k?x=y"),
        ("NCLOUD_SPEECH_SECRET", "bad\nsecret"),
        ("NCLOUD_SPEECH_MAX_UPLOAD_BYTES", "0"),
        ("NCLOUD_SPEECH_MAX_UPLOAD_BYTES", "999999999999"),
        ("NCLOUD_SPEECH_TIMEOUT_SECONDS", "7201"),
        ("NCLOUD_SPEECH_LOCAL_ROOTS", "/"),
        ("NCLOUD_SPEECH_URL_HOSTS", "*.example.com"),
    ],
)
def test_invalid_configuration_is_sanitized(monkeypatch, name, value):
    monkeypatch.setenv("NCLOUD_SPEECH_ENABLED", "true")
    monkeypatch.setenv(name, value)
    with pytest.raises(SafeError, match="values suppressed"):
        SpeechConfig.from_env()


def test_valid_configuration(monkeypatch, tmp_path):
    monkeypatch.setenv("NCLOUD_SPEECH_ENABLED", "true")
    monkeypatch.setenv(
        "NCLOUD_SPEECH_INVOKE_URL", "https://clovaspeech-gw.ncloud.com/external/v1/1/SYNTHETIC"
    )
    monkeypatch.setenv("NCLOUD_SPEECH_SECRET", "SYNTHETIC")
    monkeypatch.setenv("NCLOUD_SPEECH_LOCAL_ROOTS", str(tmp_path))
    assert SpeechConfig.from_env().configured


async def test_disabled_module_has_only_health():
    server, _ = create_server(SpeechConfig())
    assert [t.name for t in await server.list_tools()] == ["ncloud_health"]


async def test_enabled_module_registers_only_implemented_tools():
    server, registry = create_server(SpeechConfig(enabled=True))
    tools = {t.name: t for t in await server.list_tools()}
    assert set(tools) == {"ncloud_health", "clova_speech_transcribe", "clova_speech_job_status"}
    assert tools["clova_speech_transcribe"].annotations.idempotentHint is False
    assert tools["clova_speech_job_status"].annotations.readOnlyHint is True
    assert not registry.health()["services"][0]["configured"]
