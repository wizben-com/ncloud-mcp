"""Explicit module registry; future services do not register placeholder tools."""

from typing import Protocol

from mcp.server.fastmcp import FastMCP


class ServiceModule(Protocol):
    name: str

    def health(self) -> dict[str, object]: ...

    def register(self, server: FastMCP) -> None: ...


class ServiceRegistry:
    def __init__(self) -> None:
        self._modules: dict[str, ServiceModule] = {}

    def add(self, module: ServiceModule) -> None:
        if module.name in self._modules:
            raise ValueError("Duplicate service module")
        self._modules[module.name] = module

    def register(self, server: FastMCP) -> None:
        for module in self._modules.values():
            module.register(server)

    def health(self) -> dict[str, object]:
        return {"transport": "stdio", "services": [m.health() for m in self._modules.values()]}
