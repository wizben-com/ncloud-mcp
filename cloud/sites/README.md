# Optional Sites cloud adapter

[한국어 안내](README.ko.md) · [Security](SECURITY.md) · [Job lifecycle](JOBS.md)

A separate Cloudflare Worker ESM adapter for an **authenticated, owner-private
Site**, with a durable owner-scoped D1 job ledger. The portable Python stdio
package remains independent of OpenAI, Sites and Cloudflare. This source does not
install a service for a new operator: deployment, runtime settings and connection
must be configured separately. A hosted instance need not keep a user's Mac on.

## Environment settings: names, roles and requirements

The complete [environment-variable tables](../../README.md#environment-variable-reference)
separate shared Speech settings, Python-only settings and Sites-only settings.
They intentionally contain no actual credentials or personal bucket/host values.
This adapter does not read Python's local roots, upload limit or timeout settings.

Configure hosted settings in **Sites → target Site → More actions → Settings**,
not in source, `.openai/hosting.json`, a public file, chat, or a custom intake route.
Store these four entries as **Secrets**:

| Name | Role | Required? |
| --- | --- | --- |
| `NCLOUD_SPEECH_INVOKE_URL` | Base domain Invoke URL, without recognizer endpoint suffix | Speech submission/status |
| `NCLOUD_SPEECH_SECRET` | Speech domain authentication | Speech submission/status |
| `NCLOUD_ACCOUNT_ACCESS_KEY` | Account/subaccount API access key | Object Storage result recovery |
| `NCLOUD_ACCOUNT_SECRET_KEY` | Matching account/subaccount API secret | Object Storage result recovery |

The two credential pairs are different. `ACCOUNT` does not mean a main account:
prefer an explicitly authorized least-privilege subaccount. The legacy result-key
variable names are no longer consumed; there is no fallback. Changing a variable
name does not change IAM permissions. Redeploy a saved version after runtime
settings change; saving environment settings alone does not update a running version.

Required setup sequence:
1. Prepare the domain's prerequisite bucket and its result storage configuration.
2. Supply the Speech settings, enable Speech and async result persistence, and
   authorize at least one input route. URL and relayed-upload allowlists are separate.
3. For result recovery, supply the account key pair, enable the result reader,
   select one approved bucket and restrict its prefix. Bucket-root reads require
   their separate explicit opt-in. No bucket is made public.
4. Verify an existing result object's naming and configure a key template for
   unattended recovery. There is no guessed default. New relayed uploads persist
   an opaque provider filename, not the original filename; old jobs are not backfilled.
5. Deploy the code and additive D1 migrations, then check an authorized existing
   result. Offline health does not prove credentials or storage access.

Use the narrowest supported bucket-scoped read-only IAM permissions. Broad managed
VIEWER policies may cover all current and future buckets: do not assume they are
bucket-restricted. Prefix restrictions are enforced in code, not a claim about
IAM prefix support. A leaked key retains its actual IAM permissions. The result reader
uses GET only, one configured bucket and the Korea Object Storage endpoint; no
listing, write, delete, ACL or account-management operations are implemented.

## Tools and data flow

| Tool | Behavior |
| --- | --- |
| `ncloud_cloud_health` | Authenticated offline flags only |
| `clova_speech_submit_async` | At most one billable attempt per retained owner/request ID |
| `clova_speech_job_status` | Read one owned job; recover stored output when configured |
| `clova_speech_job_result_page` | Read bounded text/segment pages from an owned job |

Input routes are provider-fetched HTTPS URL, domain-relative Object Storage input,
and `upload_url`: fetch an explicitly allowlisted HTTPS media URL and relay it as
multipart. Local paths, incoming multipart endpoints, chat attachments, synchronous
recognition, callbacks and bucket management are not supported. A share page is
not a direct media URL. Never make a private source public as a workaround.

Submission acceptance is not transcript completion. In the no-callback async
contract, the transcript is written to Object Storage; a COMPLETED status can
contain no text. The reader validates the stored result's token against the owned
job before exposing content. Stored SUCCEEDED artifacts are normalized as complete;
submission SUCCEEDED is still only acceptance. No token or credential is returned.
Follow `next_offset` to the end of paginated results. Never re-transcribe merely
because retrieval failed. See [no-login workflow](NO_LOGIN_WORKFLOW.md).

Use one stable `request_id` per intentional transcription. Matching duplicate
requests return the retained job reference. No automatic retry, polling,
cancellation, timeout reclaim or deletion of deduplication records is implemented.
D1 stores ownership, hashes, provider token, states and opaque upload filename,
not credentials, source URLs, audio or transcript contents.

## Security, limits and verification

All execution requires the identity supplied by Sites dispatch. Its identity
header is not standalone authentication: keep the Site owner-private and never
expose an alternative unprotected Worker endpoint. No OAuth or key-intake API is
implemented. Transcript text is untrusted data, never executable instructions.

Relayed audio is capped at 25 MiB with no redirects or source cookies. Upload has
a 60-second deadline; ordinary provider reads have a 10-second deadline. Provider
status JSON is configurable up to 16 MiB; stored JSON has an independent fixed
16 MiB limit. RPC responses are capped at 256 KiB and result pages at 128 KiB.
These bounds do not guarantee every long recording or network condition succeeds.
Account keys avoid dependence on NAVER browser login sessions, but revoked keys,
changed permissions, unavailable sources or changed provider naming still need repair.

Offline tests use synthetic media, mock provider responses and local SQLite.
Separately, one authorized short public English sample was submitted and its
stored text/segments recovered through MCP. That does not verify arbitrary media,
all languages, all-length recordings or every hosting/client platform. New opaque
upload-name recovery is regression-tested; another paid live submission was not
performed solely to validate that change. Health is not a live test. Provider
transcription, storage, transfer and platform charges may apply.

## Build and deployment

```sh
cd cloud/sites
npm run check
npm test
npm run build
npm run validate
```

Use Node.js 24. The source manifest declares a D1 `DB` binding, no R2, and no
operator project identity. Preserve the existing private Site identity and sharing
settings in its deployment checkout. Package generated SQL/snapshots/journal with
the exact source version and apply migrations through the supported deployment
workflow, not request-time DDL. The transport is the Sites JSON-RPC subset, not a
claim of full independent HTTP MCP conformance. See [portability](../../docs/portability.md).
