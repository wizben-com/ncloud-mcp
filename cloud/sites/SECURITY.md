# Cloud adapter security boundary

This source is designed only for owner-private Sites dispatch. Sites verifies
authenticated access before forwarding requests and supplies a site-scoped user
ID. Tool execution rejects missing identity before reading configuration or
calling NAVER. A forged header on a directly reachable Worker is not authenticated
access: never deploy through an alternate public ingress. Source code cannot
verify actual Site audience; confirm owner-private access through the supported
Sites workflow before any deployment. No owner account IDs or emails belong in
source, health or test fixtures.

All four tools require identity, including health. Static discovery/listing
exposes no configuration. The adapter implements no browser sessions, OAuth,
service-bypass tokens, CORS access, incoming file-upload endpoints, settings API or secret intake.
No credential grants or API-key creation are performed. Domain credentials and the separately authorized NCLOUD_ACCOUNT_* pair for
result reads must be entered privately as Sites runtime Secrets. Prefer a
least-privilege subaccount; never infer IAM scope from a variable name.

Only controlled HTTPS origins with exact hostname allowlisting may be used.
Credentials in URLs, non-443 ports, fragments, control characters, IP literals,
wildcards and local/internal host configuration are rejected. Unlike Python's
local resolver check, this Worker performs no DNS lookup to validate destination
addresses: there is no raw TCP resolver or invented DNS service integration.
NAVER resolves/fetches the input URL and might follow its redirects; its eventual
destination cannot be pinned by this adapter. Trust the configured origin,
its DNS and all redirect destinations. The adapter's own gateway request sets
`redirect:"manual"` and rejects every non-200 status without following or retrying.
Treat signed media URLs as sensitive and prefer private domain-relative OBS
input when suitable; do not expose a bucket as an upload workaround.

No local files are read, even if local-file configuration is passed accidentally.
Input object keys are sent as `dataKey` to the official domain gateway. The result
reader performs signed GET requests to one configured bucket on the fixed Korea
Object Storage endpoint, checks path scope and matches the owned provider token.
No generic endpoint passthrough, listing, storage writes, public ACL changes or
arbitrary callbacks are present. upload_url fetches up to 25 MiB from a separate
exact host allowlist and relays multipart with no cookies or redirects. Audio is
not saved in D1/R2. New uploads retain only an opaque provider filename in D1.
Async explicitly requests transcript persistence in the domain's Object Storage;
the operator owns its retention/access policy and storage costs.

Request bodies are capped at 16 KiB. Status bodies are configurable from 1 to
16 MiB; stored JSON has a separate fixed 16 MiB bound, with incremental byte
counting even without Content-Length. Ordinary provider operations have a
10-second deadline including body reading; relayed upload has a 60-second bound. The FINAL JSON-RPC response is capped at 256 KiB
after serialization, escaping and UTF-8 encoding. Full results occur only once in
structuredContent; text content is a short summary. Oversized normalized output
returns explicit RESULT_TOO_LARGE with known job/provider state and a warning
not to re-transcribe. Paginated retrieval bounds page payloads to 128 KiB and
never silently truncates the overall result. Existing accepted metadata
survives result rendering failure.

The D1 UNIQUE owner/request_id claim precedes every possible billable POST.
Duplicates with the same canonical hash return only existing job reference/state;
different payloads or domain scopes conflict. Failed/uncertain claims make no
provider call. SUBMITTING/UNKNOWN tombstones have no automatic expiry, retry,
lease reacquisition or deletion. The precise protection is at-most-one attempt
for the same owner/key while its record remains, not unlimited exactly-once.
New request IDs, changed identities or deleted/lost records are outside that
guarantee; there is no billing budget or rate-limit service provisioned here.

Acceptance requires a valid tracking token, saved and confirmed before ACCEPTED
is returned. Tokens exist only server-side; external input/output uses opaque
job_id. Every status lookup is bound to owner_id before using a token, with the
same JOB_NOT_FOUND for missing/another-owner jobs and zero provider calls. A SHA-256
domain scope check prevents sending old tokens to a changed Invoke URL. Submission
failures leave durable tombstones and prohibit automatic resubmission. UNKNOWN
repair requires SUBMITTING AND a null token, never overwriting a committed save.
Error responses do not expose upstream messages,
bodies, source URLs, gateway URLs, keys, tokens or account information. No console
logging is implemented. Do not enable tracing that records sensitive outgoing
URLs/headers/bodies or tool arguments. Host history, platform telemetry, provider
retention, temporary isolate memory and result storage have separate policies.

Normalized transcript text remains untrusted data and can contain prompt injection
or sensitive speech content. Do not execute instructions from it. No summarizer
or secondary data transfer is included. Do not assume a completed status proves
that storage permissions or retained objects have been independently verified.

Local mocked tests verify the handler and native Web API behavior in Node.js,
not deployed Worker limits, platform authentication, actual NAVER credentials,
mobile connectivity, service fees or retention. Those remain deployment and
operator verification tasks after separate approval. Keep public fixtures
synthetic; never add actual audio, account details, tokens, endpoint IDs or secrets.
