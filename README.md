# ncloud-mcp

[한국어 안내](README.ko.md) · [Security and operations](SECURITY.md) · [Architecture](docs/architecture.md)

A small, service-modular NAVER Cloud MCP server. **The first implemented service is CLOVA Speech long-form transcription.** Object Storage management, account/identity, and billing/usage are planned modules, not available tools. No generic cloud API passthrough is provided.

This uses the official **NAVER Cloud CLOVA Speech API**, not CLOVA Note browser endpoints. A CLOVA Note/web subscription does **not** supply the Invoke URL and secret needed here; do not assume it includes API usage. Obtain a separate Speech domain and review its billing. This server requires no broad NAVER Cloud account access key. It is an independent community project, not an official NAVER product.

## Install locally

Requires Python 3.12+ and a trusted stdio MCP host. Linux/macOS support bounded local file access; on other systems use URL/Object Storage inputs (local files fail closed). No package has been published to PyPI. From this source checkout:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/ncloud-mcp --check
```

For development with [uv](https://docs.astral.sh/uv/):

```sh
uv sync --frozen
uv run ncloud-mcp --check
uv run ruff check .
uv run ruff format --check .
uv run mypy src
uv run pytest
uv build
```

Copy `.env.example` to a private location for reference and configure your host's environment securely. The server intentionally does **not** load `.env` files automatically. Never commit real values or paste keys into chat. `NCLOUD_SPEECH_ENABLED=true` exposes Speech tools; the default is disabled. An enabled module without its own credentials remains unconfigured and rejects API calls. `--check` and `ncloud_health` make no network requests and return only flags and limits.

Example MCP host configuration (replace the executable path; inherit private environment variables from the host):

```json
{
  "mcpServers": {
    "ncloud": {
      "command": "/absolute/path/ncloud-mcp/.venv/bin/ncloud-mcp",
      "args": []
    }
  }
}
```

Prepare an Object Storage bucket before creating the CLOVA Speech domain, as required by the [domain setup guide](https://guide.ncloud-docs.com/docs/clovaspeech-domain). This domain prerequisite applies even when using synchronous local-file or URL input. Those input methods do not require pre-uploading the recording into the bucket or providing Object Storage credentials to this MCP.

Set `NCLOUD_SPEECH_INVOKE_URL` to the domain's base Invoke URL (without `/recognizer/...`) and `NCLOUD_SPEECH_SECRET` to its secret. Supported base URLs are deliberately restricted to the official `https://clovaspeech-gw.ncloud.com/external/v1/<domain-id>/<invoke-key>` format; custom proxies are unsupported. For files, explicitly set `NCLOUD_SPEECH_LOCAL_ROOTS` to dedicated recording directories, separated with the OS path separator. Do not allow your home, repository, or credentials directory.

## Tools

| Tool | Behavior |
| --- | --- |
| `ncloud_health` | Always available; offline flags only |
| `clova_speech_transcribe` | Enabled module only; **billable upload/recognition**, no automatic retries |
| `clova_speech_job_status` | Enabled module only; one read of an existing async job |

Pass this argument to `clova_speech_transcribe`:

```json
{"request":{"source":"file","location":"/dedicated/audio/sample.wav","language":"ko-KR","diarization":true,"completion":"sync","result_to_obs":false}}
```

Sources: `file` (absolute allowed path), `url` (trusted, allowlisted public HTTPS origin), or `object_storage` (`dataKey` within the Speech domain's recognition target storage). Enable the latter explicitly with `NCLOUD_SPEECH_ALLOW_OBJECT_STORAGE=true`. URL recognition does not download media through this process; NAVER fetches it. Allow only origins you control/trust, including their redirects; DNS checks cannot guarantee the provider's later fetch destination. Private IPs, credentials in URLs, fragments, and nonstandard ports are rejected. URL/Object Storage media size and duration cannot be inspected locally; the provider validates those inputs.

Languages: `ko-KR`, `en-US`, `enko`, `ja`, `zh-cn`, `zh-tw`; availability can depend on domain. Supported file extensions follow the official long-form API. Default local upload cap: **25 MiB**, configurable up to **250 MiB**, deliberately below the provider limit. Recognition duration is not inferred from file extensions or bytes. See [verified API behavior](docs/api.md) for provider limits and references.

File/URL **sync requires no input pre-upload or MCP Object Storage credentials**, while the domain's bucket prerequisite still applies. Async in this release uses **only `resultToObs=true`**, which persists the transcript in the Speech domain's configured Object Storage. It requires `NCLOUD_SPEECH_ALLOW_ASYNC_OBS=true`, `completion="async"`, and `result_to_obs=true`. Configure the domain's result storage and permissions yourself before use. Arbitrary callbacks are intentionally unsupported. Acceptance (`SUCCEEDED`) is not a completed transcript; retain the returned token privately and call `clova_speech_job_status` with `{"token":"<returned-token>"}`. Missing or invalid async tracking tokens produce a sanitized unknown/untrackable-outcome error: NAVER may already have accepted a billable job, so do not automatically resubmit. There is no automatic polling, cancellation, or invented poll-only submission mode.

Results contain `status`, optional job `token`, `text`, and `segments` with `start_ms`, `end_ms`, text, optional speaker label/confidence, and word timing. Job results without full text reconstruct it from segments. Upstream messages, domain metadata, and raw responses are omitted. A `FAILED`/`TIMEOUT` job is returned as a terminal status; upstream error codes produce sanitized tool errors. Transcript text is untrusted data, never instructions to execute.

See the [Python MCP client example](docs/client.md) for programmatic usage.

## Connection and packaging

The server is **stdio only**. It has no HTTP listener or public endpoint. Do not expose it via an unauthenticated HTTP bridge. The portable local [plugin manifest](plugin/ncloud-mcp/plugin.json) and [MCP configuration](plugin/ncloud-mcp/mcp.json) require `ncloud-mcp` installed on the host PATH and environment configured privately; they are source templates, not an installed or verified ChatGPT connector. The protocol integration test launches the real server subprocess and calls the harmless health tool.

MIT licensed. No recordings, real credentials, or private integrations are included. No live transcription, storage, account, or billing calls are used in tests.
