# ncloud-mcp

[한국어 안내](README.ko.md) · [Security and operations](SECURITY.md) · [Architecture](docs/architecture.md)

A small, service-modular NAVER Cloud MCP server. **The first implemented service is CLOVA Speech long-form transcription.** Object Storage management, account/identity, and billing/usage are planned modules, not available tools. No generic cloud API passthrough is provided.

The portable core requires no Dot/OpenAI subscription or Sites/Cloudflare account. A separate, optional [Sites cloud adapter source](cloud/sites/README.md) provides an owner-private hosted async subset with URL upload and stored-result recovery. It does not replace this Python package; each operator must deploy and connect their own instance. Mobile chat attachments are not automatically accessible to that adapter. See the [transport/runtime/feature matrix](docs/portability.md).

This uses the official **NAVER Cloud CLOVA Speech API**, not CLOVA Note browser endpoints. A CLOVA Note/web subscription does **not** supply the Invoke URL and secret needed here; do not assume it includes API usage. Obtain a separate Speech domain and review its billing. The Python core requires no account API key. The optional hosted result reader separately requires an authorized account/subaccount API key pair. It is an independent community project, not an official NAVER product.

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

## Environment variable reference

Names and roles only: no real credentials, personal buckets or host settings are
included below. Configure each runtime separately. The Python core does not read
the Sites-only variables. Local `.env.example` is a reference, not an auto-loader.

### Shared Speech settings

| Variable | Role | Required? |
| --- | --- | --- |
| `NCLOUD_SPEECH_ENABLED` | Speech module enablement | Required to use Speech |
| `NCLOUD_SPEECH_INVOKE_URL` | Domain base Invoke URL; store as Secret | Required for Speech |
| `NCLOUD_SPEECH_SECRET` | Domain authentication secret; not an account API key | Required for Speech |
| `NCLOUD_SPEECH_URL_HOSTS` | Exact trusted media hosts for provider-fetched URL input | Required for URL input |
| `NCLOUD_SPEECH_ALLOW_OBJECT_STORAGE` | Permit domain-relative Object Storage input | Required for that input |
| `NCLOUD_SPEECH_ALLOW_ASYNC_OBS` | Permit persistent async results in the domain result bucket | Required for async submission |

### Portable Python stdio only

| Variable | Role | Required? |
| --- | --- | --- |
| `NCLOUD_SPEECH_LOCAL_ROOTS` | Dedicated allowed recording directories | Required for local-file input |
| `NCLOUD_SPEECH_MAX_UPLOAD_BYTES` | Bound local upload size | Optional |
| `NCLOUD_SPEECH_TIMEOUT_SECONDS` | Bound provider request duration | Optional |

### Optional Sites adapter only

| Variable | Role | Required? |
| --- | --- | --- |
| `NCLOUD_SPEECH_UPLOAD_URL_HOSTS` | Exact trusted hosts fetched by the adapter before multipart upload | Required for upload_url input |
| `NCLOUD_SPEECH_MAX_RESULT_BYTES` | Bound provider status response size | Optional |
| `NCLOUD_SPEECH_RESULT_STORAGE_ENABLED` | Enable the separate result reader | Required for stored-result recovery |
| `NCLOUD_ACCOUNT_ACCESS_KEY` | Authorized account/subaccount API access key; Secret | Required for stored-result recovery |
| `NCLOUD_ACCOUNT_SECRET_KEY` | Matching account/subaccount API secret key; Secret | Required for stored-result recovery |
| `NCLOUD_SPEECH_RESULT_BUCKET` | One approved result bucket | Required for stored-result recovery |
| `NCLOUD_SPEECH_RESULT_PREFIX` | Restrict reads to an approved object-key prefix | Required unless root access is explicitly allowed |
| `NCLOUD_SPEECH_RESULT_ALLOW_BUCKET_ROOT` | Explicitly allow an empty prefix for bucket-root results | Only for authorized root access |
| `NCLOUD_SPEECH_RESULT_KEY_TEMPLATE` | Operator-verified token/optional filename key pattern | Required for automatic recovery; optional with a known exact key |


Use the [Sites setup guide](cloud/sites/README.md) for secure entry, input choices
and limits. Account names do not imply a main-account key or broad permissions:
prefer a minimally authorized subaccount. The result reader performs GET only
against one configured bucket. It cannot reduce the permissions of a leaked key.

A completed status response may contain no transcript. The Python status tool
does not implement Object Storage result downloads; the optional hosted reader
is a separate feature. Health flags are offline checks, not proof of live access.

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
