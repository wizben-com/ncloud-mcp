"""Fail accidental internet access. Tests explicitly mock DNS where relevant."""

import socket

import pytest


@pytest.fixture(autouse=True)
def no_live_dns(monkeypatch):
    def denied(*args, **kwargs):
        pytest.fail("Live DNS/network use is forbidden in this test suite")

    monkeypatch.setattr(socket, "getaddrinfo", denied)
