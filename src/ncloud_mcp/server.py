"""stdio only: no HTTP listener and no remotely exposed local filesystem."""

import argparse
import json
import logging
import sys

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from ncloud_mcp.errors import SafeError
from ncloud_mcp.registry import ServiceRegistry
from ncloud_mcp.speech.client import SpeechClient
from ncloud_mcp.speech.config import SpeechConfig
from ncloud_mcp.speech.module import SpeechModule


def create_server(config: SpeechConfig | None = None) -> tuple[FastMCP, ServiceRegistry]:
    registry = ServiceRegistry()
    registry.add(
        SpeechModule(SpeechClient(config if config is not None else SpeechConfig.from_env()))
    )
    server = FastMCP("ncloud-mcp", log_level="ERROR")
    registry.register(server)

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))
    def ncloud_health() -> dict[str, object]:
        """Offline configuration flags only. No network, identifiers, paths, URLs, or secrets."""
        return registry.health()

    return server, registry


def main() -> None:
    parser = argparse.ArgumentParser(description="NAVER Cloud MCP server (stdio only)")
    parser.add_argument(
        "--check", action="store_true", help="Offline sanitized configuration check"
    )
    args = parser.parse_args()
    # Libraries must not log credential-bearing request URLs or response bodies.
    logging.disable(logging.CRITICAL)
    try:
        server, registry = create_server()
        if args.check:
            print(json.dumps(registry.health()))
        else:
            server.run(transport="stdio")
    except SafeError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(2) from None


if __name__ == "__main__":
    main()
