import pytest

from ncloud_mcp.registry import ServiceRegistry
from ncloud_mcp.speech.client import SpeechClient
from ncloud_mcp.speech.config import SpeechConfig
from ncloud_mcp.speech.module import SpeechModule


def test_duplicate_module_registration_is_rejected():
    registry = ServiceRegistry()
    registry.add(SpeechModule(SpeechClient(SpeechConfig())))
    with pytest.raises(ValueError, match="Duplicate service"):
        registry.add(SpeechModule(SpeechClient(SpeechConfig())))
