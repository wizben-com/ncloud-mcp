# Durable submission and ownership contract

`request_id` is a client-generated, bounded ASCII logical request key (8–128
letters/digits/underscore/hyphen). Generate it once for an intentional recording
submission. It is not the JSON-RPC transport ID. New keys can create new billable
jobs: never automatically generate a replacement key after uncertainty.

After validation and binding checks, the adapter hashes the canonical normalized
provider payload and endpoint together with `provider_scope = SHA-256(Invoke URL)`.
It atomically inserts a `SUBMITTING` record with UNIQUE `(owner_id, request_id)`
using `INSERT ... ON CONFLICT DO NOTHING`. Only a confirmed successful new insert
and matching read can reach the provider POST. A failed/uncertain claim, missing
binding or unapplied migration causes zero upstream calls. Conflicting fingerprints
are errors; matching duplicates return only opaque `job_id` and submission state.

The guarantee is **at-most-one submission attempt per user + request_id while
the record is retained**, not unlimited exactly-once. There are no automatic
TTLs, leases, reclaim, deletion or retries. A crash after claiming but before POST
can permanently block a request that never reached NAVER. This conservative
availability tradeoff avoids duplicate charges. Changing identity, deleting the
ledger, losing a database, or intentionally using another key ends that protection.

After a valid provider token is returned, the adapter stores token plus processing
status and confirms that write before returning `submission_state=ACCEPTED`.
`provider_state=SUCCEEDED` is acceptance, not completion. A timeout, invalid token,
crash or save failure cannot release the claim. It returns opaque job ID + UNKNOWN
and no-resubmission guidance. Best-effort UNKNOWN correction uses **both**
`submission_state='SUBMITTING' AND upstream_token IS NULL`; an acknowledged-lost
ACCEPTED/token write can never be clobbered by repair.

Status accepts only an opaque `job_id` made with `crypto.randomUUID()`. Before a
provider GET, the bound query uses **both job_id and owner_id**, then compares the
stored provider scope with current configuration. Missing/other-owner jobs return
identical `JOB_NOT_FOUND`; changed domains are refused. UNKNOWN/SUBMITTING records
return stored state with no POST/GET. Tokens never cross the external MCP boundary.
This owner scoping supplements, not replaces, the required private Sites gate.

## Stored data and retention

D1 contains only opaque job ID, site-scoped owner ID, logical request ID, provider
scope hash, payload hash, submission state, upstream token, provider state and
creation time. Never store API secrets, raw Invoke URLs, media URLs, recordings or
transcript contents. Hashes are identifiers, not encrypted media. D1 metadata and
tokens are private operational data: restrict database/backup access and do not
include real rows in fixtures, health or logs.

No automatic retention/purge is implemented. Deleting a tombstone can allow the
same request key to submit again. Any future privacy/token-retention procedure
must preserve deduplication tombstones where appropriate, require operator review,
and document the resulting guarantee. There is no API to clear or retry jobs.
NAVER result storage, backups, platform telemetry and MCP host history have
separate retention policies and are not verified by this adapter.

## Rendering and schema deployment

Successful submission returns metadata only, not a transcript. Status puts the full
normalized result once in `structuredContent`, with a short text summary. The final
JSON-RPC body is measured after serialization/escaping/UTF-8 encoding and capped
at 256 KiB. Oversized results return explicit `RESULT_TOO_LARGE`, the known job ID
and provider state, and a warning not to re-transcribe. The accepted record/token
is retained even when rendering fails. No pagination or silent truncation exists.

`db/schema.ts` and `drizzle.config.ts` generate bounded, schema-only migration SQL
plus snapshots/journal. These are committed and copied to `dist/.openai/drizzle`.
The installed Sites 1.1.3 packager's actual archive was verified to contain them.
Sites applies hosted migrations in its separately authorized publish workflow;
request handlers execute no CREATE/ALTER/DELETE. No live database exists here.
Applied migrations must remain immutable; append a new migration for later changes.

Tests use native Node SQLite with a thin D1 API shim, including actual UNIQUE
claim SQL and separate file-backed SQLite connections. They do not prove Cloudflare
D1 replication/failover/session behavior or platform access controls. Those remain
pre-production checks after source review and separately approved resource setup.

## Paged retrieval addition

The new `clova_speech_job_result_page` uses the same owner and domain checks with
a bounded 16 MiB default/hard maximum provider result (configurable down to 1 MiB).
The full-status API remains unchanged; page retrieval bypasses its final response
size bottleneck. No cache, new ledger columns or migration is added. See
[NO_LOGIN_WORKFLOW.md](NO_LOGIN_WORKFLOW.md) for offsets and completion checks.

## Empty completed responses and result ownership

A COMPLETED status with no transcript does not finish the retrieval workflow.
Status exposes sanitized field-presence booleans and result availability. Page
requests produce RESULT_CONTENT_NOT_RETURNED with the retained job reference.
An optional independently authorized result reader can GET a verified key from
one configured private bucket/prefix. It MUST match the artifact's provider token
to the owner's existing job before returning content. No token, storage key,
credential or raw upstream error is returned in tool diagnostics. No new job or
recognition request is created during result recovery. Stored transcript data is
not cached in D1. The retrieval module stays disabled until configured.

Storage artifact SUCCEEDED is not submission acceptance: after matching the owned
provider token, valid result artifacts normalize to COMPLETED. New upload_url jobs
store an opaque provider_filename before POST; this nullable additive ledger field
lets verified result-key templates work without retaining original media filenames.
Legacy jobs do not acquire guessed filenames. No raw transcript is stored in D1.
