# Verified API contract

Reviewed against official documentation on 2026-11-07. Tests use synthetic responses only; no production credentials or billed requests were used.

- [Local file recognition](https://api.ncloud-docs.com/docs/en/ai-application-service-clovaspeech-longsentence-local): multipart `POST /recognizer/upload`, `media` file plus JSON `params` part.
- [External file recognition](https://api.ncloud-docs.com/docs/en/ai-application-service-clovaspeech-longsentence-externalurl): JSON `POST /recognizer/url`, source in `url`.
- [Object Storage recognition](https://api.ncloud-docs.com/docs/en/ai-application-service-clovaspeech-longsentence): JSON `POST /recognizer/object-storage`, source in `dataKey` relative to domain recognition target. The table spells `datakey`, but the official request example and SDK sample use `dataKey`; this implementation follows the examples.
- [Job status](https://api.ncloud-docs.com/docs/en/ai-application-service-clovaspeech-longsentence-getjobstatus): `GET /recognizer/{token}`. Status is distinct from submission acceptance; no polling-only async shortcut is assumed.
- [Official implementation examples](https://api.ncloud-docs.com/docs/en/ai-application-service-clovaspeech-example01): domain Invoke URL plus `X-CLOVASPEECH-API-KEY`, not Ncloud account request signing.
- [Provider specifications and billing](https://guide.ncloud-docs.com/docs/en/clovaspeech-spec): long-form ceiling 2 GB; duration up to 2 hours sync / 6 hours async. Usage is billed by recognition duration; check the linked current service pricing before use. This server's upload cap is lower and no quoted price is hardcoded.
- [Official MCP Python SDK v1](https://py.sdk.modelcontextprotocol.io/v1/): maintained 1.x FastMCP API, intentionally constrained to `<2` for compatibility; `uv.lock` fixes tested versions. Moving to v2 requires a separately tested migration.

The request deliberately implements a limited verified subset: language, completion, diarization enable, full text and word alignment. No invented speaker-count control, streaming, translation, summarization, boosting, webhook management or account APIs are exposed. Async requires either a provider callback or Object Storage result persistence according to the recognition docs. This implementation chooses only the latter and enforces both request and operator opt-in.
