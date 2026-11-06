# Portable core and optional hosting adapters

The reusable Python package uses standard MCP through the official MCP Python
SDK and the official NAVER Cloud CLOVA Speech APIs. **It does not depend on a
Dot/OpenAI subscription, Sites account, Cloudflare account, OpenAI credentials,
or OpenAI identity headers.** An independent compatible MCP host can run it on
an appropriate machine with Speech domain credentials. The current core transport
is stdio; it does not implement a general hosted HTTP endpoint.

| Property | Portable Python core | Optional `cloud/sites` adapter |
| --- | --- | --- |
| Runtime | Python 3.12+ on a chosen host | Cloudflare Worker ESM through Sites |
| MCP transport/protocol | Official SDK stdio, independent compatible MCP clients | Sites-specific stateless `POST /mcp`, `server/discover` version `2026-07-28` |
| Identity boundary | Trusted local stdio host and OS user | Owner-private Sites access plus dispatch identity header |
| Input | Scoped local files, allowed HTTPS URLs, domain-relative OBS keys | Allowed HTTPS URLs or domain-relative OBS keys only |
| Recognition | Sync or opted-in async | Opted-in async only |
| Status | One-shot job status | One-shot job status |
| Async result storage | Explicit `resultToObs=true` and operator opt-in | Same; persistence disclosed in tool descriptions and results |
| Configuration health | Offline flags and limits | Authenticated offline booleans only |
| Speech credentials | Domain Invoke URL and Secret Key | Same provider credentials, later configured as hosted Secrets |
| OpenAI/Sites requirements | None | Optional hosting/authentication/connection integration only |
| Current availability | Published reusable source; install into any suitable supported MCP host | Local source under review; no Site deployment or mobile connection verified |

The existing `plugin/ncloud-mcp` manifest is an optional local-client template,
not a required component of the Python package. No Mac-specific configuration
is required by the public core; the machine running stdio must remain available
while its client uses it. A future independent HTTP adapter for another host can
be added without adopting Sites authentication or changing the Python API client.
Such an adapter is not implemented or deployed in this release.

## Avoiding service-contract drift

Worker JavaScript and Python implement a small overlapping Speech subset. They
do not import each other's runtime, SDK, identity or transport code. This avoids
requiring Python inside Workers or pulling Sites into the portable package.

`contracts/clova-speech-v1.json` contains synthetic **provider-only** request-result
normalization fixtures with no host IDs, identity headers or hosting metadata.
Both Python's `tests/test_contract.py` and the Worker's mock suite consume the
same fixtures, checking accepted/processing/completed states and identical text,
speaker and millisecond timing output. The fixture file is test data, not a
runtime dependency of the Python wheel or deployed Worker.

Both suites separately check source validation, missing async tracking tokens,
sanitized errors and no automatic billable retries. CI checks both runtimes.
When changing the shared provider subset, review official API documentation,
update both implementations and shared fixtures together, and run both suites
before merging. Independent tests are still needed for different transport
boundaries and intentional differences: the Worker has no local resolver or
filesystem, uses smaller response limits and requires Sites identity. Shared
fixtures help detect drift; they do not prove live provider compatibility.

All Sites-specific negotiation, header handling and deployment manifest fields
remain under `cloud/sites`. Adding the optional adapter has not changed the
Python package dependencies, configuration, implementation, or entrypoint.
Running only the Python package needs no Node.js installation. Developing the
optional adapter uses Node.js 24 with no external runtime dependencies.
