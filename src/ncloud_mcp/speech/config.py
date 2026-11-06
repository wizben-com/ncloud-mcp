"""Speech-specific configuration; never accepts broad Ncloud account keys."""

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from ncloud_mcp.errors import SafeError


@dataclass(frozen=True)
class SpeechConfig:
    enabled: bool = False
    invoke_url: str = field(default="", repr=False)
    secret: str = field(default="", repr=False)
    local_roots: tuple[Path, ...] = ()
    url_hosts: tuple[str, ...] = ()
    allow_object_storage: bool = False
    allow_async_obs: bool = False
    max_upload_bytes: int = 25 * 1024 * 1024
    max_response_bytes: int = 10 * 1024 * 1024
    timeout_seconds: int = 600

    @property
    def configured(self) -> bool:
        return bool(self.invoke_url and self.secret)

    def require_ready(self) -> None:
        if not self.enabled or not self.configured:
            raise SafeError(
                "CLOVA Speech is disabled or unconfigured; check operator configuration."
            )

    @classmethod
    def from_env(cls) -> "SpeechConfig":
        def boolean(name: str) -> bool:
            value = os.getenv(name, "false").lower()
            if value not in {"true", "false"}:
                raise ValueError
            return value == "true"

        try:
            enabled = boolean("NCLOUD_SPEECH_ENABLED")
            # Ignore all Speech configuration when explicitly disabled.
            if not enabled:
                return cls()
            invoke = os.getenv("NCLOUD_SPEECH_INVOKE_URL", "").rstrip("/")
            secret = os.getenv("NCLOUD_SPEECH_SECRET", "")
            if invoke and not re.fullmatch(
                r"https://clovaspeech-gw\.ncloud\.com/external/v1/[0-9]+/[A-Za-z0-9_-]+",
                invoke,
            ):
                raise ValueError
            if secret and (not secret.isascii() or any(ord(c) < 33 for c in secret)):
                raise ValueError
            roots = tuple(
                Path(p).resolve(strict=True)
                for p in os.getenv("NCLOUD_SPEECH_LOCAL_ROOTS", "").split(os.pathsep)
                if p
            )
            if any(not p.is_dir() or p == Path(p.anchor) for p in roots):
                raise ValueError
            hosts = tuple(
                h.strip().lower()
                for h in os.getenv("NCLOUD_SPEECH_URL_HOSTS", "").split(",")
                if h.strip()
            )
            if any(not re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}", h) for h in hosts):
                raise ValueError
            upload = int(os.getenv("NCLOUD_SPEECH_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
            timeout = int(os.getenv("NCLOUD_SPEECH_TIMEOUT_SECONDS", "600"))
            if not 1 <= upload <= 250 * 1024 * 1024 or not 1 <= timeout <= 7200:
                raise ValueError
            return cls(
                enabled=True,
                invoke_url=invoke,
                secret=secret,
                local_roots=roots,
                url_hosts=hosts,
                allow_object_storage=boolean("NCLOUD_SPEECH_ALLOW_OBJECT_STORAGE"),
                allow_async_obs=boolean("NCLOUD_SPEECH_ALLOW_ASYNC_OBS"),
                max_upload_bytes=upload,
                timeout_seconds=timeout,
            )
        except (ValueError, OSError, RuntimeError):
            raise SafeError(
                "Invalid CLOVA Speech environment configuration; values suppressed."
            ) from None

    def health(self) -> dict[str, object]:
        return {
            "service": "clova_speech",
            "enabled": self.enabled,
            "configured": self.configured,
            "local_upload_enabled": bool(self.local_roots),
            "remote_url_enabled": bool(self.url_hosts),
            "object_storage_enabled": self.allow_object_storage,
            "async_result_to_obs_enabled": self.allow_async_obs,
            "max_upload_bytes": self.max_upload_bytes,
            "timeout_seconds": self.timeout_seconds,
            "network_check_performed": False,
        }
