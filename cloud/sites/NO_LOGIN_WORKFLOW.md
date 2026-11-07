# Headless long-recording workflow

Speech submission uses the existing domain Invoke URL and Secret, not NAVER login
cookies. Retrieving async transcripts additionally requires authorized result-storage
read access, as detailed below; the domain Secret alone is insufficient.

## Root cause

`enabled/configured` previously meant only Speech and its secrets were present.
Input routes and async persistence were independently disabled; cloud file upload
was absent; long results exceeded the 1 MiB provider / 256 KiB RPC caps.

`ready_for_async_submission` checks configuration, input, persistence and DB binding.
`ready_for_async_transcription` additionally requires a configured result reader
and an operator-verified key template. Both are OFFLINE and do not prove live
credentials, migrations, actual storage permissions or correct key mapping.
Never report live end-to-end success from health alone.

## Processing completion is not transcript retrieval

The official async contract says a request with no callback and resultToObs=true
sends recognition output **only to Object Storage**. The status API documents a
COMPLETED response with empty segments. The prior assumption that polling status
would always return the transcript was wrong. A real 11-second public sample
confirmed acceptance/completion but returned no text or segments. No retry was
performed. This does not prove that the source was silent or recognition was empty.

Status now reports `result_available`, `result_retrieved`, and text/segments field
presence. A completed empty status response marks `result_retrieval_required`;
pages fail with RESULT_CONTENT_NOT_RETURNED rather than claim an empty transcript
was successfully recovered. Retrieve the existing result artifact, never resubmit.

An optional read-only Object Storage module is OFF by default. It uses the fixed
Korea endpoint kr.object.ncloudstorage.com and kr-standard region, one bucket,
a nonempty prefix (or explicitly authorized bucket root), GET only, no redirects, 16 MiB limit, and bounded deadlines.
The returned JSON must be SUCCEEDED or COMPLETED and its token must match the owned job's
server-side token before any transcript is exposed. No list/write/delete/ACL
operations or credential fallback exist.

Configuration, only after explicit authorization:
- NCLOUD_SPEECH_RESULT_STORAGE_ENABLED=true
- NCLOUD_SPEECH_RESULT_BUCKET: identified result bucket
- NCLOUD_SPEECH_RESULT_PREFIX: allowed nonempty path ending in /
- NCLOUD_SPEECH_RESULT_ALLOW_BUCKET_ROOT=true: explicitly permit an empty prefix
  only for an authorized result bucket whose artifacts are stored at its root.
  Default false; enabling this does not weaken a configured nonempty prefix.
- NCLOUD_ACCOUNT_ACCESS_KEY and NCLOUD_ACCOUNT_SECRET_KEY: Site Secrets
  for a separately approved read-only subaccount, not the main-account key.
- Optional NCLOUD_SPEECH_RESULT_KEY_TEMPLATE: verified actual object-key pattern
  under the prefix containing exactly one {token} and optionally one {filename}.
  {filename} is the persisted opaque upload name, never a lookup-time user input.
  There is NO guessed default.

NAVER documentation does not establish IAM prefix-scoped permissions: request the
narrowest supported bucket scope and additionally enforce the prefix in code.
The operator must verify actual GET permission and object naming. If no stable
verified template exists, pass the exact existing `object_key` to the page tool.
That avoids a login only when the key is already known; full automatic discovery
is not implemented. An empty result object matched to the job is distinguished
from an empty status response (`result_retrieved=true`).

The Speech domain secret cannot sign Object Storage requests. Without additional
read access or an already-authorized result artifact, this integration cannot
recover private persisted results by itself. A new public callback receiver is a
separate alternative for future jobs, not recovery for this one; do not make this
private Site public or put a Sites bypass token in a callback URL.

## Direct media source

`source=url` lets NAVER fetch from `NCLOUD_SPEECH_URL_HOSTS`.
`source=upload_url` fetches from the separate exact allowlist
`NCLOUD_SPEECH_UPLOAD_URL_HOSTS`, then relays multipart to `/recognizer/upload`.
Set `filename` to the supported filename matching actual bytes, e.g. `audio.ogg`.
Renaming is not conversion. Ogg requires the `OggS` signature, not full validation.
Both require `NCLOUD_SPEECH_ALLOW_ASYNC_OBS=true` and `result_to_obs=true` with
approved transmission/billing and an already configured private result bucket.

Upload is bounded to 25 MiB, rejects redirects and HTML/JSON, omits credentials
to the media source, and suppresses raw URLs/errors. One upload is permitted per
Worker instance. Source download plus submission has a 60-second deadline, but
platform limits may interrupt earlier. Keep media URLs private: signed download
URLs are access capabilities. D1 stores hashes, not these URLs or recordings.

Only allow trusted media hosts: this is not a general DNS/private-IP filtering
proxy. A trusted host may resolve internally, so arbitrary host allowlisting is
unsafe. A share page is not a media URL. Chat attachments, private Drive pages and
local paths are not automatically accessible. For those, use the portable local
MCP uploader or separately authorized owner-scoped staging, not a public bucket
or an unexplained browser-login fallback.

The durable claim occurs before download. A failed source download conservatively
retains an UNKNOWN tombstone even if no provider POST occurred. Never automatically
change request_id to retry. Renewed signed URLs also change the fingerprint and
will conflict with the same request_id. These are deliberate availability limits.

## Long result retrieval

Use `clova_speech_job_result_page` with the returned job_id, format=text or segments,
offset=0 and a bounded limit. Text offsets count Unicode code points, not UTF-16
units or bytes. Follow next_offset until null; use total/count/offset to verify
completeness. Assemble only COMPLETED results. Segment pages shrink to 128 KiB;
individual oversized segments explicitly fail and can be read as text pages.
Every page reads the existing job without a billable POST. The legacy status tool
is unchanged and can still hit its 256 KiB final response cap.

NCLOUD_SPEECH_MAX_RESULT_BYTES defaults to 16777216, with 1048576–16777216 allowed.
Larger provider artifacts explicitly fail rather than truncate. Retrieve those
existing Object Storage artifacts through separately authorized access; do not
re-transcribe. No finite bound guarantees every six-hour recording.

## Before claiming completion

Build/validate the exact artifact including helper modules. Preserve owner-private
access. Set the approved input allowlist and persistence settings and deploy.
Then, with authorization, submit one short non-sensitive sample once and verify
completion, paged reconstruction and retrieval in a fresh client session. Do not
re-run a customer meeting as an unannounced paid smoke test. Offline tests do not
prove real NAVER behavior or platform runtime limits. These source changes do not
deploy, alter secrets, or perform any live call.

A real result artifact uses `result=SUCCEEDED`; matched storage artifacts are exposed
as completed results. One verified upload artifact used `<filename>_<token>.json`.
This observation does not establish a universal naming contract. Do not apply a
single sample filename template to unrelated future submissions.

For newly submitted upload_url jobs, the adapter sends an opaque audio_<job UUID>
filename retaining only the actual supported extension and saves that name before
POST. It does not store the original filename. A verified {filename}_{token}.json
template enables direct retrieval without listing objects. Existing jobs have no
backfilled filename; use their exact object key or a separately verified fixed
filename template. Original request fingerprint/idempotency semantics are unchanged.

The NCLOUD_ACCOUNT_* names identify an API credential pair, not a requirement to
use the main account. Prefer the authorized subaccount. Names do not change IAM
permissions. NCLOUD_SPEECH_SECRET authenticates the Speech domain separately.
