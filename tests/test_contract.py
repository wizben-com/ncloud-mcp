"""Provider-only contract fixtures; no dependency on any host or cloud adapter."""

import json
from pathlib import Path

import pytest

from ncloud_mcp.speech.client import normalize

CONTRACT = json.loads(
    (Path(__file__).resolve().parents[1] / "contracts" / "clova-speech-v1.json").read_text()
)


@pytest.mark.parametrize("case", CONTRACT["cases"], ids=lambda case: case["name"])
def test_provider_normalization_contract(case):
    assert CONTRACT["contract_version"] == 1
    result = normalize(case["provider"], require_token=case["require_token"])
    assert result.model_dump() == case["normalized"]
