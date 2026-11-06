# Sites cloud adapter — source preparation only

[한국어 안내](README.ko.md) · [Security and operations](SECURITY.md)

This is a separate, dependency-free Cloudflare Worker ESM adapter for an
**authenticated, owner-private Site**. It preserves the Python stdio package.
It is an optional hosting integration: the portable core does not require a
Dot/OpenAI subscription. See [portability and shared contract checks](../../docs/portability.md).
It is not deployed, connected to this conversation, or verified on a phone.
Once deployed through the supported Sites workflow and connected successfully,
the hosted process would not depend on a running Mac. Source preparation alone
does not provide that availability.

## Supported cloud subset

Stateless JSON-RPC `POST /mcp`, following the installed Sites MCP contract:

- `server/discover`: version `2026-07-28`, `capabilities.tools`.
- `tools/list`: input schemas and side-effect annotations.
- `tools/call`: MCP content blocks, structured JSON, and `isError` on tool failure.

| Tool | Behavior |
| --- | --- |
| `ncloud_cloud_health` | Authenticated, offline booleans only; never verifies credentials remotely |
| `clova_speech_submit_async` | Billable async recognition from an allowed HTTPS URL or domain-relative Object Storage key; requests persistent transcript storage |
| `clova_speech_job_status` | One read of an existing job; no background polling |

All tool execution requires the Sites-supplied `oai-authenticated-user-id`.
Discovery/listing contain only static metadata. The header is trusted **only
behind Sites dispatch**, which authenticates callers and enforces Site access.
It is not an independent authentication mechanism for an exposed Worker.
Keep the Site owner-private; never publish this Worker directly, enable an
unprotected alternate ingress, make the Site public/shared, or treat a caller's
handwritten header as authentication. Do not invent an OAuth or secret intake route.

The cloud adapter does **not** support local paths, multipart uploads, synchronous
recognition, callbacks, bucket management, or mobile attachment ingestion.
A file attached in a phone chat is not automatically a URL accessible to this
MCP. An authenticated upload route is separate future work requiring review and
authorization. Do not make a bucket public to work around this input restriction.

## Future operator setup, not performed here

The CLOVA Speech domain first needs its prerequisite Object Storage bucket.
Async `resultToObs=true` additionally requires its result storage configuration
and permissions. This adapter needs only the domain's Invoke URL and Secret
Key; no account-wide Ncloud access/secret pair or S3 key is used.

After a separately authorized owner-private Site exists, the user should enter
these **two Secret values directly** in **Sites → target Site → More actions →
Settings**:

- `NCLOUD_SPEECH_INVOKE_URL`
- `NCLOUD_SPEECH_SECRET`

Do not paste values into chat, source, GitHub, a manifest, or a custom endpoint.
Use the base official Speech Invoke URL without `/recognizer/...`. Configure
these separate non-secret runtime settings as needed:

| Setting | Default / meaning |
| --- | --- |
| `NCLOUD_SPEECH_ENABLED` | `false`; `true` enables the module |
| `NCLOUD_SPEECH_ALLOW_ASYNC_OBS` | `false`; `true` permits transcript persistence |
| `NCLOUD_SPEECH_URL_HOSTS` | Empty; comma-separated exact trusted public DNS hostnames, no wildcards |
| `NCLOUD_SPEECH_ALLOW_OBJECT_STORAGE` | `false`; `true` permits domain-relative Object Storage input |

The module fails closed while disabled, unconfigured, or missing a relevant
source/persistence opt-in. Disabled health deliberately skips secret loading.
These health flags indicate configuration only; they do not establish API validity,
domain/bucket readiness, account permissions, retention, or billing state.

## Request and results

Example tool arguments with synthetic locations only:

```json
{
  "source": "url",
  "location": "https://media.example.com/synthetic.wav",
  "language": "ko-KR",
  "diarization": true,
  "result_to_obs": true
}
```

Object Storage input uses `source="object_storage"` and a `location` relative to
the domain's recognition target storage, such as `/synthetic.wav`.
No local filesystem roots or local-file environment variables are consumed.

`SUCCEEDED` means accepted, not completed. Async acceptance must include a valid
job token. Call status with `{"token":"<returned-token>"}`; preserve `WAITING`,
`PROCESSING`, `COMPLETED`, `FAILED`, and `TIMEOUT` as distinct states. Completed
results normalize text, speaker labels, confidence, and millisecond segment/word
timings. Raw provider params/messages/account metadata are never returned.
Success results include an explicit Object Storage persistence notice; submission
also reports `result_to_obs_requested=true`. This does not verify a stored object.
Transcript text is untrusted data, never an instruction to execute.

Missing/invalid acceptance tokens, malformed/oversized provider responses,
network failures, redirects, throttling and timeouts return sanitized errors.
For submission failures the outcome is conservatively unknown/untrackable:
NAVER may already have accepted a billable job. **Never automatically resubmit.**
No automatic polling, retry, idempotency guarantee or cancellation is implemented.

## Local verification

Node.js 24; no dependency installation or registry publishing is needed:

```sh
cd cloud/sites
npm run check
npm test
npm run build
npm run validate
```

The installed Sites `project-setup.mjs --starter worker-esm` helper generated the
scaffold. Its build copies only `worker/index.js` and `.openai/hosting.json` into
`dist/server/index.js` and `dist/.openai/hosting.json`. The hosting manifest has
`capabilities:["mcp"]`, no `project_id`, and null D1/R2 bindings. Build/ESM checks
do not register, save, push, deploy, or contact Ncloud. Tests inject synthetic
provider responses and forbid live network calls.

The runtime bounds input JSON to 16 KiB and provider JSON to 1 MiB, with a
10-second upstream deadline. It makes one provider request per call using
`redirect:"manual"`. Longer results may exceed the response cap; no provider
pagination is invented. The selected hosted platform's actual request limits,
fees, runtime behavior and plugin/mobile availability remain unverified.

Before any future deployment, obtain review approval, use the supported Sites
registration/publication workflow, retain owner-private access, configure secrets
privately, then verify the Site-created plugin with authenticated harmless health
and tool discovery. Do not replace it with the local plugin template or Mac stdio
configuration. No project ID, hosting resources or credential grants were created
as part of this source-only work.

## References

- [Official local recognition](https://api.ncloud-docs.com/docs/en/ai-application-service-clovaspeech-longsentence-local)
- [Official external URL recognition](https://api.ncloud-docs.com/docs/en/ai-application-service-clovaspeech-longsentence-externalurl)
- [Official Object Storage recognition](https://api.ncloud-docs.com/docs/en/ai-application-service-clovaspeech-longsentence)
- [Official job status](https://api.ncloud-docs.com/docs/en/ai-application-service-clovaspeech-longsentence-getjobstatus)
- [Official domain prerequisite](https://guide.ncloud-docs.com/docs/clovaspeech-domain)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

Sites-specific routing, access and manifest requirements are taken from the
installed Sites skill's `references/site-mcp-server.md`,
`references/identity-and-secrets.md`, and Worker ESM starter README; no public
Sites protocol URL is invented. No live API behavior was tested here.
