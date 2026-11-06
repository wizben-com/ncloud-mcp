import socket

import pytest
from pydantic import ValidationError

from ncloud_mcp.errors import SafeError
from ncloud_mcp.speech.config import SpeechConfig
from ncloud_mcp.speech.models import TranscriptionRequest
from ncloud_mcp.speech.sources import read_media, validate_object_key, validate_url


def test_file_read_and_limits(tmp_path):
    media = tmp_path / "synthetic.wav"
    media.write_bytes(b"RIFFsynthetic")
    config = SpeechConfig(local_roots=(tmp_path,), max_upload_bytes=100)
    assert read_media(str(media), config) == b"RIFFsynthetic"
    with pytest.raises(SafeError):
        read_media(str(media), SpeechConfig(local_roots=(tmp_path,), max_upload_bytes=2))
    media.write_bytes(b"")
    with pytest.raises(SafeError):
        read_media(str(media), config)


def test_symlinks_traversal_outside_and_directory_denied(tmp_path):
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    outside = tmp_path / "outside.wav"
    outside.write_bytes(b"synthetic")
    link = allowed / "linked.wav"
    link.symlink_to(outside)
    folder_link = allowed / "folder"
    folder_link.symlink_to(tmp_path, target_is_directory=True)
    config = SpeechConfig(local_roots=(allowed,))
    for path in (
        outside,
        link,
        folder_link / "outside.wav",
        allowed / ".." / "outside.wav",
        allowed / "directory.wav",
        "relative.wav",
        allowed / "missing.wav",
    ):
        with pytest.raises(SafeError):
            read_media(str(path), config)


@pytest.mark.parametrize(
    "location",
    [
        "http://media.example.com/a.wav",
        "https://other.example.com/a.wav",
        "https://media.example.com:8443/a.wav",
        "https://u:p@media.example.com/a.wav",
        "https://media.example.com/a.wav#fragment",
        "https://127.0.0.1/a.wav",
        "https://media.example.com/a\n.wav",
        "https://media.example.com\\@evil.test/a",
    ],
)
async def test_unsafe_urls_fail_before_dns(location, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("DNS must not run for rejected URLs")

    monkeypatch.setattr(socket, "getaddrinfo", forbidden)
    with pytest.raises(SafeError):
        await validate_url(location, SpeechConfig(url_hosts=("media.example.com",)))


@pytest.mark.parametrize("address", ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1"])
async def test_private_dns_denied(address, monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", (address, 443))])
    with pytest.raises(SafeError):
        await validate_url(
            "https://media.example.com/a.wav", SpeechConfig(url_hosts=("media.example.com",))
        )


async def test_allowed_public_dns(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("8.8.8.8", 443))])
    await validate_url(
        "https://media.example.com/a.wav", SpeechConfig(url_hosts=("media.example.com",))
    )


@pytest.mark.parametrize(
    "key", ["../a.wav", "a/../b.wav", "https://x/a.wav", "a//b.wav", "a\nb.wav"]
)
def test_bad_object_keys(key):
    with pytest.raises(SafeError):
        validate_object_key(key, SpeechConfig(allow_object_storage=True))


def test_object_key_permission_and_leading_slash():
    with pytest.raises(SafeError):
        validate_object_key("a.wav", SpeechConfig())
    validate_object_key("/sample.wav", SpeechConfig(allow_object_storage=True))


@pytest.mark.parametrize(
    "extra",
    [
        {"completion": "async"},
        {"result_to_obs": True},
        {"language": "unsupported"},
        {"diarization": "false"},
        {"callback": "https://example.com"},
    ],
)
def test_request_validation(extra):
    with pytest.raises(ValidationError):
        TranscriptionRequest(source="file", location="/a.wav", **extra)
