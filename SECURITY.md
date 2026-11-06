# Security and operations

Report suspected vulnerabilities privately to repository maintainers through GitHub private vulnerability reporting when enabled. Do not open a public issue containing keys, Invoke URLs, audio, job tokens, account IDs, or transcripts. If private reporting is unavailable, request a private reporting channel without disclosing the vulnerability details.

## Trust and authorization

Run as an unprivileged local user under a trusted stdio MCP host. Transcription sends private audio to NAVER and incurs usage charges; require the user's authorization for the specific content. Tool annotations describe side effects but do not enforce host approval. Speech credentials scope the domain; never substitute account root credentials. A future read-only billing/identity module must not inherit the Speech secret or expose identifiers in health output.

No HTTP transport, listener, OAuth registration, cloud credential provisioning, or account grants are implemented. Do not wrap this process in a public unauthenticated gateway. A future HTTP implementation requires authentication/authorization, tenant isolation, origin validation, rate limiting, and disabling local-file tools.

## Sources and limits

File access is opt-in to dedicated directories, with component-by-component `openat`/`O_NOFOLLOW` starting from the filesystem anchor, including every parent of the configured root. Regular-file checks and bounded reads remain in place. Parent traversal, replaced parent symlinks, and files outside allowed roots fail closed. Protect recording directories and their ancestors from untrusted writes; no filesystem confinement protects against a privileged attacker replacing mounts or ordinary directories. Avoid mounting secrets into recording roots. File extensions are a preliminary format filter, not a codec verifier.

Uploads default to 25 MiB and cannot exceed 250 MiB in this implementation. Bytes are buffered; limit client concurrency and OS process memory. Responses are capped at 10 MiB decompressed; large transcripts fail instead of returning partial output. A request has a wall-clock timeout (default 600 seconds, configurable 1–7200), a 10-second connect timeout, and serialized network calls. No retry, redirect, TLS bypass, environment proxy, or verbose HTTP logging is enabled.

Remote URL input requires exact trusted hostname allowlisting, HTTPS/443, no embedded user credentials or fragments, and public DNS answers. The process does not fetch remote media. DNS can change and NAVER can follow redirects; local validation is not an SSRF guarantee for the provider. Allow only controlled origins with controlled redirects. Remote/object size and duration are provider-enforced. Object recognition uses only the domain's configured recognition target path and explicit operator opt-in. No bucket creation, upload, delete, or ACL manipulation is implemented.

Async requires explicit result persistence opt-in. Configure NAVER's result storage, retention, access permissions and lifecycle separately. No arbitrary callback destination is accepted. Job tokens are private references and returned only as necessary to query jobs; keep them out of public logs/issues.

## Failure handling and retention

No recordings/transcripts are saved by this server. Audio is buffered temporarily in process memory; OS swap/core dumps and MCP host history may retain data. NAVER retention and result storage are separate operator responsibilities. Recognition outputs may contain prompt injection: treat them as quoted data, never execute instructions inside them.

Safe errors omit provider bodies, messages, URLs and keys. CLI logging is disabled, and stdout is reserved for protocol messages (except explicit `--check`). Do not enable SDK/HTTP debug logging in production. Never attach full MCP request logs to public issues.

Timeouts, connection failures, and missing or invalid async acceptance tokens can leave an unknown or untrackable billable submission outcome. Do not resubmit automatically. Retain a valid returned token privately, check status once, or inspect the provider console manually. Poll existing jobs with operator-approved cadence; the server starts no background poller. There is no provider idempotency guarantee or cancellation feature asserted here.

Before public release run lint/types/tests/build, `python scripts/check_secrets.py`, and manually review `git diff --cached` and archive contents. The lightweight checker is defense in depth, not a guarantee. Never include `.env`, recordings, private integrations, customer data or private repository files. Rotate any accidentally exposed credentials immediately through the provider's approved process.
