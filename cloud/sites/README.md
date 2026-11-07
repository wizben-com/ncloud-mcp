# Sites cloud adapter — source preparation only

[한국어 안내](README.ko.md) · [Security and operations](SECURITY.md)

This is a separate, runtime dependency-free Cloudflare Worker ESM adapter for an
**authenticated, owner-private Site**. It preserves the Python stdio package.
It is an optional hosting integration: the portable core does not require a
Dot/OpenAI subscription. See [portability and shared contract checks](../../docs/portability.md).
It is not deployed, connected to this conversation, or verified on a phone.
Once deployed through the supported Sites workflow and connected successfully,
the hosted process would not depend on a running Mac. Source preparation alone
does not provide that availability.

## Supported cloud subset

Stateless JSON-RPC transport at `POST /mcp`, with a durable owner-scoped D1 job
ledger, following the installed Sites MCP contract:

- `server/discover`: version `2026-07-28`, `capabilities.tools`.
- `tools/list`: input schemas and side-effect annotations.
- `tools/call`: MCP content blocks, structured JSON, and `isError` on tool failure.

Compatibility is narrowly scoped to this Sites adapter, not full MCP 2026-07-28
transport conformance. `tools/call` permits optional object-valued `params._meta`
with arbitrary opaque vendor/trace/progress keys; it is ignored for authorization,
tool arguments, storage, hashes and upstream requests. Omitted arguments become
`{}`; explicit null/array/string arguments remain invalid. The root allowlist
is unchanged. Continuation params `requestState`/`inputResponses` are explicitly
unsupported. Every JSON-RPC result has `resultType:"complete"`, including tool
failures and size-limit results; JSON-RPC error objects do not. The final byte
limit includes this marker. References: [CallToolRequestParams](https://modelcontextprotocol.io/specification/2026-07-28/schema#calltoolrequestparams),
[metadata](https://modelcontextprotocol.io/specification/2026-07-28/basic#meta),
[responses](https://modelcontextprotocol.io/specification/2026-07-28/basic#responses).

| Tool | Behavior |
| --- | --- |
| `ncloud_cloud_health` | Authenticated, offline booleans only; never verifies credentials remotely |
| `clova_speech_submit_async` | Claim an owner + `request_id`, then make at most one billable submission attempt; return an opaque `job_id`, never a provider token |
| `clova_speech_job_status` | Owner-scoped lookup by `job_id`, then at most one provider read; no raw tokens or background polling |

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
The `job_store_bound` flag checks only binding presence, with no database I/O or
migration readiness check. These health flags indicate configuration only; they do not establish API validity,
domain/bucket readiness, account permissions, retention, or billing state.

## Request and results

Example tool arguments with synthetic locations only:

```json
{
  "request_id": "client-generated-stable-uuid",
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

Generate `request_id` once per intentional transcription and retain/reuse it on
duplicate delivery. It is bounded ASCII, separate from the transport JSON-RPC
`id`. A confirmed D1 UNIQUE claim on `(owner_id, request_id)` precedes any POST.
The canonical submission fingerprint includes the SHA-256 provider scope.
Matching duplicates return only the existing opaque `job_id` and
`submission_state`; a changed payload/domain is a conflict, never an automatic
new submission. See [job lifecycle and retention](JOBS.md).

Submission returns metadata only after its token/state write is confirmed.
`submission_state="ACCEPTED"` and `provider_state="SUCCEEDED"` mean accepted,
not completed. Provider tokens stay server-side. Call status with
`{"job_id":"<returned-job-id>"}`; the owner must match and the stored domain
scope must match current configuration before any provider GET. `SUBMITTING`
and `UNKNOWN` never trigger POST/GET. Processing states `WAITING`, `PROCESSING`,
`COMPLETED`, `FAILED`, and `TIMEOUT` remain distinct from submission state.
Completed status normalizes text, speaker/confidence and millisecond timings.
Raw provider params/messages/account metadata and tokens are never returned.
Successful submission/status carries an explicit Object Storage persistence
notice; this does not independently verify a stored object. Transcript text is
untrusted data, never an instruction to execute.

Missing/invalid acceptance tokens, malformed/oversized provider responses,
network failures, redirects, throttling and timeouts return sanitized errors.
For submission failures the outcome is conservatively unknown/untrackable:
NAVER may already have accepted a billable job. **Never automatically resubmit.**
There is an **at-most-one submission attempt for the same user + request_id while
its record is retained**, not an unlimited exactly-once guarantee. A crash before
the POST can leave an unused claim permanently blocked. No TTL, lease reclaim,
automatic retry/polling, cancellation, or tombstone deletion is implemented.
After a possible POST, even failed token persistence leaves `SUBMITTING`/`UNKNOWN`
and returns only an opaque reference and warning. A conditional UNKNOWN repair
cannot overwrite a committed token.

## Local verification

Node.js 24 runs checks/tests/build without runtime dependencies. Development-only
Drizzle tools are pinned for schema generation; no registry publishing is needed:

```sh
cd cloud/sites
npm run check
npm test
npm run build
npm run validate
```

For a reviewed schema change only, use `npm ci` then `npm run db:generate`.
Commit generated SQL, snapshots and journal. Existing migrations are immutable
after application; append schema-only, bounded migrations. No migration is applied
by a tool request. Local tests apply generated SQL to actual local SQLite behind
a narrow D1 API shim; this is not a live D1 test or a complete D1 emulator.

The installed Sites `project-setup.mjs --starter worker-esm` helper generated the
scaffold. The extended build includes the Worker, hosting manifest, and complete
`drizzle/` tree under `dist/.openai/drizzle`. The installed Sites 1.1.3
`package-site.mjs` also packages that migration tree, including metadata, into
the actual archive. The hosting manifest has `capabilities:["mcp"]`, logical
`d1:"DB"`, no `project_id`, and null R2 binding. This does not provision a database.
Build/ESM/migration checks
do not register, save, push, deploy, or contact Ncloud. Tests inject synthetic
provider responses and forbid live network calls.

The runtime bounds input JSON to 16 KiB and provider JSON to 1 MiB, with a
10-second upstream deadline and a **256 KiB cap on the final serialized JSON-RPC
response**, including UTF-8 encoding and escaping. Full transcripts appear once
in `structuredContent`; text content is a small summary. Oversized final results
return `RESULT_TOO_LARGE` with the known job/provider state and an explicit
no-re-transcription warning; the accepted ledger record survives. There is no
silent truncation or invented pagination. The selected platform's actual limits,
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

## Headless uploads and large results

See [NO_LOGIN_WORKFLOW.md](NO_LOGIN_WORKFLOW.md) for the `upload_url` route,
exact media-host allowlists, offline readiness and paged transcript retrieval.
No account-wide credential or NAVER browser session is required for these routes.
