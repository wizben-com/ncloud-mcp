# Service boundaries and future modules

`server.py` owns stdio and offline `ncloud_health`. `ServiceRegistry` accepts modules through a small `ServiceModule` protocol (`name`, `health`, `register`). Each module owns its configuration, validation, upstream client and tool definitions. A disabled service registers no action tools; unconfigured enabled services reject upstream operations. Duplicate module names are rejected. Health contains readiness flags, never account/domain IDs or credentials.

Only `speech/` is implemented. Future entries below are architectural directions, **not registered modules or callable tools**:

| Module direction | Official reference | Required separation |
| --- | --- | --- |
| Object Storage | [Object Storage API](https://api.ncloud-docs.com/docs/en/storage-objectstorage) | Separate operator-scoped storage credentials; distinguish list/head/read from upload/delete/ACL. Do not conflate Object Storage and Ncloud Storage API products. |
| Account/identity | [Sub Account API](https://api.ncloud-docs.com/docs/en/management-subaccount) | Verify supported identity lookup endpoints and minimal IAM permissions before implementing. No claim that arbitrary account profile discovery is available. |
| Billing/usage | [Cost and Usage API](https://api.ncloud-docs.com/docs/en/platform-costandusage) | Read-only scopes, date/pagination bounds, sensitive billing output; no cost/account details in health or public fixtures. |

The references establish service API families, not an assertion that all planned use cases are implemented or available to every account. Before adding a module, verify exact endpoints, authentication, regional/platform support, least-privilege policies, errors and pagination in current official docs. Add independent enablement/credentials, mock contract tests and protocol tests; never add an arbitrary endpoint passthrough.

Speech file/URL sync calls require only the Speech domain Invoke URL/secret in this MCP, with no input pre-upload. Creating the domain still requires a prepared Object Storage bucket, as described in the [domain guide](https://guide.ncloud-docs.com/docs/clovaspeech-domain). Object Storage can be used as input without this server managing buckets. Async without a callback needs `resultToObs=true`, which persists the transcript in the domain's configured result storage; this is not a reason to require account-wide keys from sync users. A future storage management tool must obtain separate authorization for writes, deletes and public ACLs, even if read-only discovery is already authorized. Billable Speech tools remain explicitly non-idempotent; companion read-only tools must not silently trigger transcription or storage writes.

This source package contains no private business integrations, persistence layer or remote HTTP endpoint. No cloud actions are performed at startup or by health. Adding another service must preserve these properties or explicitly document and test changes to them.
