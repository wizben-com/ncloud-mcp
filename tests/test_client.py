import asyncio
import json
from dataclasses import replace

import httpx
import pytest

from ncloud_mcp.errors import SafeError
from ncloud_mcp.speech.client import SpeechClient, normalize
from ncloud_mcp.speech.config import SpeechConfig
from ncloud_mcp.speech.models import TranscriptionRequest


@pytest.fixture
def config():
    return SpeechConfig(
        enabled=True,
        invoke_url="https://clovaspeech-gw.ncloud.com/external/v1/1/SYNTHETIC",
        secret="SYNTHETIC_TEST_SECRET",
        allow_object_storage=True,
    )


def completed():
    return {
        "result": "COMPLETED",
        "token": "synthetic-token",
        "message": "private body",
        "params": {"private": "omit"},
        "segments": [
            {
                "start": 0,
                "end": 1000,
                "text": "Synthetic speech",
                "diarization": {"label": "1"},
                "confidence": 0.9,
                "words": [[0, 1000, "Synthetic speech"]],
            }
        ],
    }


def test_normalize_allowlisted_fields_only():
    result = normalize(completed())
    assert result.text == "Synthetic speech"
    assert result.segments[0].start_ms == 0
    assert result.segments[0].speaker == "1"
    assert result.segments[0].words[0].end_ms == 1000
    assert "private" not in result.model_dump_json()


@pytest.mark.parametrize(
    "data",
    [
        None,
        [],
        {"result": "ERROR", "message": "secret"},
        {"result": "COMPLETED", "segments": [{"start": 2, "end": 1, "text": "x"}]},
        {"result": "COMPLETED", "segments": None},
        {"result": "COMPLETED", "token": "a/b"},
    ],
)
def test_bad_responses_sanitized(data):
    with pytest.raises(SafeError, match="details suppressed"):
        normalize(data)


async def test_object_storage_wire_contract(config):
    calls = []

    def handler(request):
        calls.append(request)
        assert request.url.path.endswith("/recognizer/object-storage")
        assert request.headers["X-CLOVASPEECH-API-KEY"] == "SYNTHETIC_TEST_SECRET"
        body = json.loads(request.content)
        assert body["dataKey"] == "/sample.wav"
        assert body["completion"] == "sync"
        assert body["diarization"] == {"enable": False}
        assert "callback" not in body
        return httpx.Response(200, json=completed())

    client = SpeechClient(config, httpx.MockTransport(handler))
    result = await client.transcribe(
        TranscriptionRequest(
            source="object_storage", location="/sample.wav", language="en-US", diarization=False
        )
    )
    assert result.status == "COMPLETED"
    assert len(calls) == 1


async def test_multipart_upload(config, tmp_path):
    path = tmp_path / "private-filename.wav"
    path.write_bytes(b"RIFFsynthetic")

    def handler(request):
        assert request.url.path.endswith("/recognizer/upload")
        assert request.headers["content-type"].startswith("multipart/form-data")
        assert b'filename="media.wav"' in request.content
        assert b"private-filename" not in request.content
        assert b'"completion": "sync"' in request.content
        assert b'"language": "ko-KR"' in request.content
        assert b"RIFFsynthetic" in request.content
        assert b"application/json" in request.content
        return httpx.Response(200, json=completed())

    client = SpeechClient(replace(config, local_roots=(tmp_path,)), httpx.MockTransport(handler))
    assert (await client.transcribe(TranscriptionRequest(source="file", location=str(path)))).text


async def test_url_contract(config, monkeypatch):
    async def validate(location, conf):
        assert location == "https://media.example.com/synthetic.wav"

    monkeypatch.setattr("ncloud_mcp.speech.client.validate_url", validate)

    def handler(request):
        assert request.url.path.endswith("/recognizer/url")
        assert json.loads(request.content)["url"] == "https://media.example.com/synthetic.wav"
        return httpx.Response(200, json=completed())

    await SpeechClient(config, httpx.MockTransport(handler)).transcribe(
        TranscriptionRequest(source="url", location="https://media.example.com/synthetic.wav")
    )


async def test_async_requires_operator_permission_then_returns_acceptance(config):
    request = TranscriptionRequest(
        source="object_storage", location="sample.wav", completion="async", result_to_obs=True
    )
    with pytest.raises(SafeError, match="persistence is disabled"):
        await SpeechClient(config).transcribe(request)

    def handler(request):
        body = json.loads(request.content)
        assert body["completion"] == "async" and body["resultToObs"] is True
        return httpx.Response(200, json={"result": "SUCCEEDED", "token": "synthetic-token"})

    result = await SpeechClient(
        replace(config, allow_async_obs=True), httpx.MockTransport(handler)
    ).transcribe(request)
    assert result.status == "SUCCEEDED" and result.text == ""


@pytest.mark.parametrize(
    "response",
    [
        {"result": "SUCCEEDED"},
        {"result": "SUCCEEDED", "token": None},
        {"result": "SUCCEEDED", "token": "invalid/token"},
        {"result": "SUCCEEDED", "token": 123},
        {"result": "COMPLETED"},
    ],
)
async def test_async_tracking_failure_warns_unknown_outcome_without_retry(config, response):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=response)

    client = SpeechClient(replace(config, allow_async_obs=True), httpx.MockTransport(handler))
    with pytest.raises(SafeError, match="unknown or untrackable") as caught:
        await client.transcribe(
            TranscriptionRequest(
                source="object_storage",
                location="sample.wav",
                completion="async",
                result_to_obs=True,
            )
        )
    assert len(calls) == 1
    assert "may have accepted a billable job" in str(caught.value)
    assert "Do not automatically resubmit" in str(caught.value)
    assert config.secret not in str(caught.value)
    assert "invalid/token" not in str(caught.value)


async def test_sync_completed_response_needs_no_token(config):
    response = completed()
    response.pop("token")
    client = SpeechClient(config, httpx.MockTransport(lambda r: httpx.Response(200, json=response)))
    result = await client.transcribe(
        TranscriptionRequest(source="object_storage", location="sample.wav")
    )
    assert result.status == "COMPLETED"
    assert result.token is None
    assert result.text == "Synthetic speech"


@pytest.mark.parametrize("status", ["WAITING", "PROCESSING", "COMPLETED", "FAILED", "TIMEOUT"])
async def test_status_is_single_read(config, status):
    calls = []

    def handler(request):
        calls.append(request)
        assert request.method == "GET"
        assert request.url.path.endswith("/recognizer/synthetic-token")
        return httpx.Response(200, json={"result": status, "token": "synthetic-token"})

    result = await SpeechClient(config, httpx.MockTransport(handler)).job_status("synthetic-token")
    assert result.status == status
    assert len(calls) == 1


@pytest.mark.parametrize("token", ["../bad", "x?url=", "", "x" * 257])
async def test_invalid_tokens_never_sent(config, token):
    with pytest.raises(SafeError, match="Invalid job token"):
        await SpeechClient(config).job_status(token)


@pytest.mark.parametrize("status", [302, 401, 413, 429, 500])
async def test_http_failures_not_retried_and_body_suppressed(config, status):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(
            status, text="PRIVATE_UPSTREAM_DETAIL", headers={"Location": "https://evil.example/"}
        )

    with pytest.raises(SafeError) as caught:
        await SpeechClient(config, httpx.MockTransport(handler)).transcribe(
            TranscriptionRequest(source="object_storage", location="sample.wav")
        )
    assert len(calls) == 1
    assert "PRIVATE_UPSTREAM_DETAIL" not in str(caught.value)
    assert config.secret not in str(caught.value)


@pytest.mark.parametrize("error", [httpx.ReadTimeout, httpx.ConnectError])
async def test_network_failure_has_unknown_outcome_and_no_retry(config, error):
    calls = []

    def handler(request):
        calls.append(request)
        raise error("PRIVATE_URL_AND_SECRET")

    with pytest.raises(SafeError, match="outcome may be unknown") as caught:
        await SpeechClient(config, httpx.MockTransport(handler)).transcribe(
            TranscriptionRequest(source="object_storage", location="sample.wav")
        )
    assert len(calls) == 1
    assert "PRIVATE_URL_AND_SECRET" not in str(caught.value)


async def test_response_cap_and_invalid_json(config):
    for body, limit, message in [(b"x" * 100, 10, "exceeded"), (b"not-json", 100, "invalid JSON")]:
        client = SpeechClient(
            replace(config, max_response_bytes=limit),
            httpx.MockTransport(lambda r, body=body: httpx.Response(200, content=body)),
        )
        with pytest.raises(SafeError, match=message):
            await client.job_status("synthetic-token")


async def test_unconfigured_client_makes_no_request():
    def handler(request):
        pytest.fail("Network must not run")

    with pytest.raises(SafeError, match="disabled or unconfigured"):
        await SpeechClient(SpeechConfig(enabled=True), httpx.MockTransport(handler)).job_status("x")


async def test_total_timeout_is_sanitized_and_does_not_retry(config):
    calls = []

    async def handler(request):
        calls.append(request)
        await asyncio.Event().wait()

    client = SpeechClient(replace(config, timeout_seconds=1), httpx.MockTransport(handler))
    with pytest.raises(SafeError, match="outcome may be unknown"):
        await client.transcribe(
            TranscriptionRequest(source="object_storage", location="sample.wav")
        )
    assert len(calls) == 1


async def test_submissions_are_serialized(config):
    active = 0
    maximum = 0

    async def handler(request):
        nonlocal active, maximum
        active += 1
        maximum = max(maximum, active)
        await asyncio.sleep(0.01)
        active -= 1
        return httpx.Response(200, json=completed())

    client = SpeechClient(config, httpx.MockTransport(handler))
    request = TranscriptionRequest(source="object_storage", location="sample.wav")
    await asyncio.gather(client.transcribe(request), client.transcribe(request))
    assert maximum == 1
