# Python MCP client example

Install this source package first and configure the service-specific environment
privately as described in README. This launches a local stdio server. The health
call is offline; **the transcription call below is billable and uploads audio**.
Run it only for a recording you are authorized to process.

```python
import asyncio
import os
import sys
from datetime import timedelta

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main():
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "ncloud_mcp.server"],
        env=dict(os.environ),
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(
            read, write, read_timeout_seconds=timedelta(seconds=660)
        ) as session:
            await session.initialize()
            health = await session.call_tool("ncloud_health", {})
            print(health.structuredContent)
            result = await session.call_tool("clova_speech_transcribe", {
                "request": {
                    "source": "file",
                    "location": "/dedicated/audio/sample.wav",
                    "language": "ko-KR",
                    "diarization": True,
                    "completion": "sync",
                    "result_to_obs": False,
                }
            })
            if result.isError:
                raise RuntimeError("Transcription failed; inspect the sanitized MCP error privately")
            # Keep transcripts out of shared logs; consume result.structuredContent privately.


asyncio.run(main())
```

The host may impose a shorter tool deadline than the server. Use async with an
explicit Object Storage result sink for work that exceeds the host deadline;
do not resubmit a timed-out synchronous request automatically. No paid request
from this example is part of development or CI testing.
