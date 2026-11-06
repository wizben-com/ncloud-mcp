"""One request per invocation: no retries, redirects, or credential-bearing diagnostics."""

import asyncio
import json
import re
from typing import Any

import httpx
from pydantic import ValidationError

from ncloud_mcp.errors import SafeError
from ncloud_mcp.speech.config import SpeechConfig
from ncloud_mcp.speech.models import Segment, Transcript, TranscriptionRequest, Word
from ncloud_mcp.speech.sources import read_media, validate_object_key, validate_url

TOKEN = re.compile(r"[A-Za-z0-9_-]{1,256}")


def normalize(data: Any) -> Transcript:
    """Select known public fields, never return raw params/messages/error bodies."""
    try:
        if not isinstance(data, dict):
            raise ValueError
        status = data["result"]
        if status not in {"SUCCEEDED", "WAITING", "PROCESSING", "FAILED", "COMPLETED", "TIMEOUT"}:
            raise ValueError
        token = data.get("token")
        if token is not None and (not isinstance(token, str) or not TOKEN.fullmatch(token)):
            raise ValueError
        segments = []
        for item in data.get("segments", []):
            speaker = item.get("speaker") or item.get("diarization") or {}
            words = [Word(start_ms=w[0], end_ms=w[1], text=w[2]) for w in item.get("words", [])]
            segments.append(
                Segment(
                    start_ms=item["start"],
                    end_ms=item["end"],
                    text=item["text"],
                    confidence=item.get("confidence"),
                    speaker=speaker.get("label"),
                    words=words,
                )
            )
        return Transcript(
            status=status,
            token=token,
            segments=segments,
            text=data.get("text", " ".join(s.text for s in segments)),
        )
    except (ValueError, KeyError, TypeError, IndexError, AttributeError, ValidationError):
        raise SafeError(
            "CLOVA Speech returned an error or invalid response; details suppressed."
        ) from None


class SpeechClient:
    def __init__(self, config: SpeechConfig, transport: httpx.AsyncBaseTransport | None = None):
        self.config = config
        self.transport = transport
        self._lock = asyncio.Lock()
        self._submission_lock = asyncio.Lock()

    async def _request(self, method: str, endpoint: str, **kwargs: Any) -> Transcript:
        self.config.require_ready()
        # Bound both concurrency and wall time, including waiting for another request.
        try:
            async with asyncio.timeout(self.config.timeout_seconds):
                async with (
                    self._lock,
                    httpx.AsyncClient(
                        transport=self.transport,
                        trust_env=False,
                        follow_redirects=False,
                        timeout=httpx.Timeout(self.config.timeout_seconds, connect=10),
                        headers={
                            "X-CLOVASPEECH-API-KEY": self.config.secret,
                            "Accept": "application/json",
                        },
                    ) as client,
                    client.stream(method, self.config.invoke_url + endpoint, **kwargs) as response,
                ):
                    if response.status_code != 200:
                        raise SafeError(
                            f"CLOVA Speech HTTP {response.status_code}; details suppressed. "
                            "Do not automatically resubmit a transcription."
                        )
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > self.config.max_response_bytes:
                            raise SafeError("CLOVA Speech response exceeded the configured limit.")
                    return normalize(json.loads(body))
        except (TimeoutError, httpx.TimeoutException):
            raise SafeError(
                "CLOVA Speech timed out; submission outcome may be unknown. "
                "Do not automatically resubmit."
            ) from None
        except httpx.HTTPError:
            raise SafeError(
                "CLOVA Speech network failure; submission outcome may be unknown. "
                "Do not automatically resubmit."
            ) from None
        except (ValueError, UnicodeError):
            raise SafeError("CLOVA Speech returned invalid JSON; details suppressed.") from None

    async def transcribe(self, request: TranscriptionRequest) -> Transcript:
        # Serialize preparation too, so simultaneous file calls cannot buffer many uploads.
        try:
            async with asyncio.timeout(self.config.timeout_seconds), self._submission_lock:
                return await self._transcribe(request)
        except TimeoutError:
            raise SafeError(
                "CLOVA Speech timed out; submission outcome may be unknown. "
                "Do not automatically resubmit."
            ) from None

    async def _transcribe(self, request: TranscriptionRequest) -> Transcript:
        self.config.require_ready()
        if request.result_to_obs and not self.config.allow_async_obs:
            raise SafeError("Async Object Storage result persistence is disabled by the operator.")
        params: dict[str, Any] = {
            "language": request.language,
            "completion": request.completion,
            "diarization": {"enable": request.diarization},
            "wordAlignment": True,
            "fullText": True,
            "resultToObs": request.result_to_obs,
        }
        if request.source == "file":
            media = await asyncio.to_thread(read_media, request.location, self.config)
            suffix = request.location.rsplit(".", 1)[-1].lower()
            return await self._request(
                "POST",
                "/recognizer/upload",
                files={
                    "media": (f"media.{suffix}", media, "application/octet-stream"),
                    "params": (None, json.dumps(params), "application/json"),
                },
            )
        if request.source == "url":
            await validate_url(request.location, self.config)
            params["url"] = request.location
            endpoint = "/recognizer/url"
        else:
            validate_object_key(request.location, self.config)
            params["dataKey"] = request.location
            endpoint = "/recognizer/object-storage"
        return await self._request("POST", endpoint, json=params)

    async def job_status(self, token: str) -> Transcript:
        if not TOKEN.fullmatch(token):
            raise SafeError("Invalid job token format.")
        return await self._request("GET", "/recognizer/" + token)
