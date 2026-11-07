# Verified API contract

Reviewed against official documentation on 2026-11-07. Tests use synthetic responses only; no production credentials or billed requests were used.

- [Local file recognition](https://api.ncloud-docs.com/docs/en/ai-application-service-clovaspeech-longsentence-local): multipart `POST /recognizer/upload`, `media` file plus JSON `params` part.
- [External file recognition](https://api.ncloud-docs.com/docs/en/ai-application-service-clovaspeech-longsentence-externalurl): JSON `POST /recognizer/url`, source in `url`.
- [Object Storage recognition](https://api.ncloud-docs.com/docs/en/ai-application-service-clovaspeech-longsentence): JSON `POST /recognizer/object-storage`, source in `dataKey` relative to domain recognition target. The table spells `datakey`, but the official request example and SDK sample use `dataKey`; this implementation follows the examples.
- [Job status](https://api.ncloud-docs.com/docs/en/ai-application-service-clovaspeech-longsentence-getjobstatus): `GET /recognizer/{token}`. Status is distinct from submission acceptance; no polling-only async shortcut is assumed.
- [Official implementation examples](https://api.ncloud-docs.com/docs/en/ai-application-service-clovaspeech-example01): domain Invoke URL plus `X-CLOVASPEECH-API-KEY`, not Ncloud account request signing.
- [Speech domain setup](https://guide.ncloud-docs.com/docs/clovaspeech-domain): prepare an Object Storage bucket before creating the Speech domain. Synchronous file/URL input avoids pre-uploading the input recording and does not require this MCP to hold Object Storage credentials; it does not remove the domain's bucket prerequisite.
- [Provider specifications and billing](https://guide.ncloud-docs.com/docs/en/clovaspeech-spec): long-form ceiling 2 GB; duration up to 2 hours sync / 6 hours async. Usage is billed by recognition duration; check the linked current service pricing before use. This server's upload cap is lower and no quoted price is hardcoded.
- [Official MCP Python SDK v1](https://py.sdk.modelcontextprotocol.io/v1/): maintained 1.x FastMCP API, intentionally constrained to `<2` for compatibility; `uv.lock` fixes tested versions. Moving to v2 requires a separately tested migration.

The request deliberately implements a limited verified subset: language, completion, diarization enable, full text and word alignment. No invented speaker-count control, streaming, translation, summarization, boosting, webhook management or account APIs are exposed. Async requires either a provider callback or Object Storage result persistence according to the recognition docs. This implementation chooses only the latter and enforces both request and operator opt-in. It persists the transcript to the domain's result bucket. Async submissions require a valid returned tracking token; a missing/invalid token is an unknown or untrackable billable outcome, never permission to resubmit automatically. Completed synchronous responses may omit the token.

## Async retrieval correction (2026-11-08)

The official upload async-delivery matrix specifies that no callback plus
`resultToObs=true` returns recognition output **only to Object Storage**.
The job-status documentation includes `COMPLETED` with empty segments. Therefore
status completion cannot be treated as proof of transcript retrieval. A live
public 11-second sample reached completion but status returned no content; no
second recognition request was made. Empty status is not evidence of silence.
The optional cloud read-only result module requires separately authorized OBS
access and a known result key (or verified operator template); the Speech domain
Secret is not an Object Storage key. No key naming convention is invented.

Official storage references:
- https://api.ncloud-docs.com/docs/storage-objectstorage-getobject
- https://guide.ncloud-docs.com/docs/storage-objectstorage-subaccount
