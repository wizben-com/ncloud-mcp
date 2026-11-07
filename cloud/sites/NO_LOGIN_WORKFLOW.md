# Headless long-recording workflow

The adapter uses the existing domain Invoke URL and Secret, not NAVER login
cookies or account-wide API keys. No new Object Storage credentials are required.

## Root cause

`enabled/configured` previously meant only Speech and its secrets were present.
Input routes and async persistence were independently disabled; cloud file upload
was absent; long results exceeded the 1 MiB provider / 256 KiB RPC caps.

`ready_for_async_transcription` now checks configuration, input, persistence and
DB binding. It is OFFLINE and does not prove authentication, migrations or actual
result-bucket permissions. Never report live success from health alone.

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
