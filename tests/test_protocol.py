import os
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def test_real_stdio_initialize_discover_and_health():
    env = {k: v for k, v in os.environ.items() if not k.startswith("NCLOUD_SPEECH_")}
    env["NCLOUD_SPEECH_ENABLED"] = "false"
    parameters = StdioServerParameters(
        command=sys.executable, args=["-m", "ncloud_mcp.server"], env=env
    )
    async with stdio_client(parameters) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        tools = await session.list_tools()
        assert [tool.name for tool in tools.tools] == ["ncloud_health"]
        result = await session.call_tool("ncloud_health", {})
        assert not result.isError
        assert result.structuredContent["services"][0]["enabled"] is False


async def test_enabled_unconfigured_stdio_rejects_without_network():
    env = {k: v for k, v in os.environ.items() if not k.startswith("NCLOUD_SPEECH_")}
    env["NCLOUD_SPEECH_ENABLED"] = "true"
    parameters = StdioServerParameters(
        command=sys.executable, args=["-m", "ncloud_mcp.server"], env=env
    )
    async with stdio_client(parameters) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        result = await session.call_tool("clova_speech_job_status", {"token": "synthetic-token"})
        assert result.isError
        assert "disabled or unconfigured" in result.content[0].text
