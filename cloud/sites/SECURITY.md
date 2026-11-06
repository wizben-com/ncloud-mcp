# Cloud adapter security boundary

This source is designed only for owner-private Sites dispatch. Sites verifies
authenticated access before forwarding requests and supplies a site-scoped user
ID. Tool execution rejects missing identity before reading configuration or
calling NAVER. A forged header on a directly reachable Worker is not authenticated
access: never deploy through an alternate public ingress. Source code cannot
verify actual Site audience; confirm owner-private access through the supported
Sites workflow before any deployment. No owner account IDs or emails belong in
source, health or test fixtures.

All three tools require identity, including health. Static discovery/listing
exposes no configuration. The adapter implements no browser sessions, OAuth,
service-bypass tokens, CORS access, uploads, settings API or secret intake.
No credential grants or API-key creation are performed. The two domain values
must later be entered privately as Sites runtime Secrets by the user. Broad
account keys and S3 credentials are not used.

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
Object keys are sent as `dataKey` only to the official domain gateway. No generic
endpoint passthrough, S3 operations, public ACL changes or arbitrary callbacks
are present. User audio is never fetched through the Worker or saved in D1/R2.
Async explicitly requests transcript persistence in the domain's Object Storage;
the operator owns its retention/access policy and storage costs.

Request bodies are capped at 16 KiB and response bodies at 1 MiB, with incremental
byte counting even without Content-Length. Provider operations have a 10-second
deadline including response-body reading. One call performs one upstream request;
there are no retries, redirects or pollers. Private platform access does not
provide deduplication or a billing budget. Repeated authorized tool calls can
create repeated charges. Configure appropriate operational budgets separately
before real use; no budget or rate-limit service is provisioned here.

Acceptance requires a valid tracking token. Submission failures conservatively
report unknown/untrackable outcomes and prohibit automatic resubmission. Tokens
are necessary private references in successful results and inputs, but never
appear in error messages. Error responses do not expose upstream messages,
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
