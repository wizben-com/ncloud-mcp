"""Explicit source permissions and bounded local reads, with no URL fetching."""

import asyncio
import ipaddress
import os
import socket
import stat
from pathlib import Path
from urllib.parse import urlsplit

from ncloud_mcp.errors import SafeError
from ncloud_mcp.speech.config import SpeechConfig

FORMATS = {
    "mp3",
    "aac",
    "ac3",
    "ogg",
    "flac",
    "wav",
    "m4a",
    "avi",
    "mp4",
    "mov",
    "wmv",
    "flv",
    "mkv",
}


def read_media(location: str, config: SpeechConfig) -> bytes:
    """Open every component relative to a directory fd; disallow all symlinks."""
    try:
        path = Path(location)
        if not path.is_absolute() or ".." in path.parts or path.suffix.lower()[1:] not in FORMATS:
            raise ValueError
        root = next(r for r in config.local_roots if path.is_relative_to(r))
        parts = path.relative_to(root).parts
        if (
            not root.is_absolute()
            or ".." in root.parts
            or not parts
            or not hasattr(os, "O_NOFOLLOW")
            or os.open not in os.supports_dir_fd
        ):
            raise ValueError
        # Start at the filesystem anchor: opening root by its full path would follow
        # replaced symlinks in any of its parent components despite O_NOFOLLOW.
        fd = os.open(root.anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            for part in (*root.parts[1:], *parts[:-1]):
                next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = next_fd
            media_fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
            with os.fdopen(media_fd, "rb") as stream:
                info = os.fstat(stream.fileno())
                if (
                    not stat.S_ISREG(info.st_mode)
                    or not 0 < info.st_size <= config.max_upload_bytes
                ):
                    raise ValueError
                data = stream.read(config.max_upload_bytes + 1)
                if not 0 < len(data) <= config.max_upload_bytes:
                    raise ValueError
                return data
        finally:
            os.close(fd)
    except (OSError, ValueError, StopIteration):
        raise SafeError(
            "Local source denied, unreadable, unsupported, empty, or oversized."
        ) from None


async def validate_url(location: str, config: SpeechConfig) -> None:
    try:
        url = urlsplit(location)
        if (
            url.scheme != "https"
            or url.hostname not in config.url_hosts
            or url.port not in {None, 443}
            or url.username
            or url.password
            or url.fragment
            or any(ord(c) <= 32 or ord(c) >= 127 for c in location)
            or "\\" in location
        ):
            raise ValueError
        addresses = await asyncio.wait_for(
            asyncio.to_thread(socket.getaddrinfo, url.hostname, 443, type=socket.SOCK_STREAM), 5
        )
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise ValueError
    except (OSError, ValueError, TimeoutError):
        raise SafeError("Remote URL denied; use an allowed, trusted public HTTPS origin.") from None


def validate_object_key(location: str, config: SpeechConfig) -> None:
    if (
        not config.allow_object_storage
        or len(location) > 1024
        or any(part in {".", "..", ""} for part in location.lstrip("/").split("/"))
        or any(ord(c) < 32 for c in location)
        or "://" in location
        or "\\" in location
    ):
        raise SafeError("Object Storage source disabled or key invalid.")
