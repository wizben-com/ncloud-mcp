import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import worker, { createWorker, configuration, submission, normalize, LIMITS } from "../worker/index.js";

const env = {
  NCLOUD_SPEECH_ENABLED: "true",
  NCLOUD_SPEECH_INVOKE_URL: "https://clovaspeech-gw.ncloud.com/external/v1/0000/SYNTHETIC",
  NCLOUD_SPEECH_SECRET: "SYNTHETIC_TEST_SECRET",
  NCLOUD_SPEECH_URL_HOSTS: "media.example.com",
  NCLOUD_SPEECH_ALLOW_OBJECT_STORAGE: "true",
  NCLOUD_SPEECH_ALLOW_ASYNC_OBS: "true",
};
const args = { source: "url", location: "https://media.example.com/synthetic.wav", result_to_obs: true };
const config = configuration(env);
const accepted = { result: "SUCCEEDED", token: "synthetic-token" };
const completed = { result: "COMPLETED", token: "synthetic-token", message: "PRIVATE_PROVIDER_BODY",
  params: { account: "PRIVATE_PROVIDER_BODY" }, segments: [{ start: 0, end: 1000,
    text: "Synthetic speech", confidence: 0.9, diarization: { label: "1" },
    words: [[0, 1000, "Synthetic speech"]] }] };

// Block accidental network throughout this suite. All upstream calls are injected mocks.
globalThis.fetch = () => { throw new Error("Live network forbidden"); };
const noNetwork = () => { assert.fail("No upstream call allowed"); };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });

function request(method, params, { identity = true, ...init } = {}) {
  return new Request("https://adapter.example.com/mcp", {
    method: "POST", headers: { "Content-Type": "application/json",
      ...(identity ? { "oai-authenticated-user-id": "synthetic-owner" } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }), ...init,
  });
}
async function call(server, name, arguments_ = {}, bindings = env, options = {}) {
  const response = await server.fetch(request("tools/call", { name, arguments: arguments_ }, options), bindings);
  return { response, rpc: await response.json() };
}
function safeFailure(rpc) {
  assert.equal(rpc.result.isError, true);
  const text = JSON.stringify(rpc);
  for (const value of [env.NCLOUD_SPEECH_SECRET, env.NCLOUD_SPEECH_INVOKE_URL,
    args.location, "synthetic-token", "PRIVATE_PROVIDER_BODY"]) assert.ok(!text.includes(value));
}

test("Sites discovery and tool schemas expose only the cloud subset", async () => {
  const server = createWorker({ fetchImpl: noNetwork });
  const discovered = await (await server.fetch(request("server/discover"))).json();
  assert.deepEqual(discovered.result, { supportedVersions: ["2026-07-28"], capabilities: { tools: {} } });
  const listed = await (await server.fetch(request("tools/list"))).json();
  assert.equal(listed.result.tools.length, 3);
  const submit = listed.result.tools.find((t) => t.name === "clova_speech_submit_async");
  assert.deepEqual(submit.inputSchema.properties.source.enum, ["url", "object_storage"]);
  assert.equal(submit.annotations.idempotentHint, false);
  assert.match(submit.description, /persisted.*Object Storage/);
});

test("every tool rejects missing identity before reading environment or fetching", async () => {
  const bindings = new Proxy({}, { get: () => assert.fail("No config access before identity") });
  for (const name of ["ncloud_cloud_health", "clova_speech_submit_async", "clova_speech_job_status"]) {
    const { response, rpc } = await call(createWorker({ fetchImpl: noNetwork }), name, {}, bindings,
      { identity: false });
    assert.equal(response.status, 403);
    assert.equal(rpc.error.code, -32001);
  }
});

test("authenticated health is offline and booleans only; disabled ignores secrets", async () => {
  const server = createWorker({ fetchImpl: noNetwork });
  const { response, rpc } = await call(server, "ncloud_cloud_health");
  assert.equal(rpc.result.isError, false);
  assert.ok(Object.values(rpc.result.structuredContent).every((value) => typeof value === "boolean"));
  assert.equal(rpc.result.structuredContent.network_check_performed, false);
  assert.ok(!JSON.stringify(rpc).includes(env.NCLOUD_SPEECH_SECRET));
  assert.ok(!JSON.stringify(rpc).includes("media.example.com"));
  assert.equal(response.headers.get("cache-control"), "no-store");
  const bindings = { NCLOUD_SPEECH_ENABLED: "false",
    get NCLOUD_SPEECH_SECRET() { assert.fail("Disabled module must not inspect secret"); } };
  const disabled = await call(server, "ncloud_cloud_health", {}, bindings);
  assert.equal(disabled.rpc.result.structuredContent.configured, false);
  const defaultArguments = await (await server.fetch(request("tools/call",
    { name: "ncloud_cloud_health" }), {})).json();
  assert.equal(defaultArguments.result.isError, false);
});

test("URL submission sends verified async fields exactly once; does not forward caller identity", async () => {
  let calls = 0;
  const server = createWorker({ fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, env.NCLOUD_SPEECH_INVOKE_URL + "/recognizer/url");
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers["X-CLOVASPEECH-API-KEY"], env.NCLOUD_SPEECH_SECRET);
    assert.ok(!Object.hasOwn(options.headers, "oai-authenticated-user-id"));
    assert.deepEqual(JSON.parse(options.body), { language: "ko-KR", completion: "async",
      resultToObs: true, fullText: true, wordAlignment: true, diarization: { enable: true }, url: args.location });
    return json(accepted);
  } });
  const { rpc } = await call(server, "clova_speech_submit_async", args);
  assert.equal(calls, 1);
  assert.equal(rpc.result.structuredContent.status, "SUCCEEDED");
  assert.equal(rpc.result.structuredContent.text, "");
  assert.equal(rpc.result.structuredContent.storage.result_to_obs_requested, true);
  assert.match(rpc.result.structuredContent.storage.notice, /persistence/);
});

test("Object Storage input is domain-relative; no S3 credentials or bucket operations", async () => {
  let calls = 0;
  const server = createWorker({ fetchImpl: async (url, options) => {
    calls++;
    assert.ok(url.endsWith("/recognizer/object-storage"));
    const body = JSON.parse(options.body);
    assert.equal(body.dataKey, "/synthetic.wav");
    assert.equal(body.language, "en-US");
    assert.equal(body.diarization.enable, false);
    return json(accepted);
  } });
  const { rpc } = await call(server, "clova_speech_submit_async", { source: "object_storage",
    location: "/synthetic.wav", language: "en-US", diarization: false, result_to_obs: true });
  assert.equal(rpc.result.isError, false);
  assert.equal(calls, 1);
});

test("unsafe sources and extra/incorrect arguments fail before network", () => {
  const invalid = [
    { ...args, source: "file", location: "/recordings/synthetic.wav" },
    { ...args, result_to_obs: false }, { ...args, result_to_obs: "true" },
    { ...args, callback: "https://other.example.com/" }, { ...args, completion: "sync" },
    { ...args, diarization: "false" }, { ...args, language: "unsupported" },
    { ...args, location: "https://media.example.com:8443/a.wav" },
    { ...args, location: "https://media.example.com.evil.example/a.wav" },
    { ...args, location: "http://media.example.com/a.wav" },
    { ...args, location: "https://u:p@media.example.com/a.wav" },
    { ...args, location: "https://media.example.com/a.wav#" },
    { ...args, location: "https://media.example.com/a\n.wav" },
    { ...args, location: "https://media.example.com\\@evil.example/a.wav" },
    { ...args, location: "https://127.0.0.1/a.wav" },
    { ...args, source: "object_storage", location: "../a.wav" },
    { ...args, source: "object_storage", location: "//a.wav" },
    { ...args, source: "object_storage", location: "a/../b.wav" },
    { ...args, source: "object_storage", location: "a\u0000.wav" },
  ];
  for (const value of invalid) assert.throws(() => submission(value, config));
  assert.throws(() => submission(args, { ...config, persist: false }), /persistence.*disabled/);
  assert.throws(() => submission({ ...args, source: "object_storage", location: "a.wav" },
    { ...config, obs: false }), /source disabled/);
});

test("disabled/unconfigured/invalid operator configuration fails closed without leaking values", async () => {
  const server = createWorker({ fetchImpl: noNetwork });
  for (const overrides of [ { NCLOUD_SPEECH_ENABLED: "false" }, { "NCLOUD_SPEECH_SECRET": "" },
    { NCLOUD_SPEECH_INVOKE_URL: "https://evil.example/PRIVATE_PROVIDER_BODY" },
    { NCLOUD_SPEECH_INVOKE_URL: env.NCLOUD_SPEECH_INVOKE_URL + "\n" },
    { NCLOUD_SPEECH_URL_HOSTS: "*.example.com" }, { NCLOUD_SPEECH_URL_HOSTS: "media.localhost" },
    { NCLOUD_SPEECH_ALLOW_ASYNC_OBS: "false" } ]) {
    safeFailure((await call(server, "clova_speech_submit_async", args, { ...env, ...overrides })).rpc);
  }
});

test("one-shot status preserves distinct states and normalized word timing", async () => {
  for (const status of ["WAITING", "PROCESSING", "FAILED", "TIMEOUT", "COMPLETED"]) {
    let calls = 0;
    const server = createWorker({ fetchImpl: async (url, options) => {
      calls++;
      assert.ok(url.endsWith("/recognizer/synthetic-token"));
      assert.equal(options.method, "GET");
      assert.equal(options.body, undefined);
      return json({ ...completed, result: status });
    } });
    const { rpc } = await call(server, "clova_speech_job_status", { token: "synthetic-token" });
    assert.equal(calls, 1);
    assert.equal(rpc.result.structuredContent.status, status);
    assert.equal(rpc.result.structuredContent.segments[0].words[0].end_ms, 1000);
    assert.equal(rpc.result.structuredContent.text, "Synthetic speech");
    assert.ok(!JSON.stringify(rpc).includes("PRIVATE_PROVIDER_BODY"));
  }
});

test("missing/invalid async acceptance tracking is uncertain and never retried", async () => {
  for (const value of [{ result: "SUCCEEDED" }, { result: "SUCCEEDED", token: null },
    { result: "SUCCEEDED", token: "PRIVATE_PROVIDER_BODY/bad" },
    { result: "SUCCEEDED", token: "synthetic-token\n" }, { result: "COMPLETED" }]) {
    let calls = 0;
    const server = createWorker({ fetchImpl: async () => { calls++; return json(value); } });
    const { rpc } = await call(server, "clova_speech_submit_async", args);
    safeFailure(rpc);
    assert.equal(calls, 1);
    assert.match(rpc.result.content[0].text, /unknown or untrackable/);
    assert.match(rpc.result.content[0].text, /Do not automatically resubmit/);
  }
});

test("unsafe status tokens fail without requests; malformed results are sanitized", async () => {
  for (const token of ["../bad", "x?url=PRIVATE_PROVIDER_BODY", "", "x".repeat(257), "synthetic-token\n"]) {
    safeFailure((await call(createWorker({ fetchImpl: noNetwork }), "clova_speech_job_status", { token })).rpc);
  }
  for (const value of [null, { result: "ERROR", message: "PRIVATE_PROVIDER_BODY" },
    { result: "COMPLETED", segments: [{ start: 10, end: 0, text: "x" }] },
    { result: "COMPLETED", text: 123 },
    { result: "COMPLETED", segments: [{ start: 0, end: 10, text: "x", confidence: 5 }] }]) {
    assert.throws(() => normalize(value), /response.*suppressed/);
  }
  assert.equal(normalize({ result: "COMPLETED" }).token, null);
});

test("redirects, throttling and upstream failures never retry or expose provider details", async () => {
  for (const status of [301, 302, 401, 413, 429, 500]) {
    let calls = 0;
    const server = createWorker({ fetchImpl: async (_, options) => {
      calls++;
      assert.equal(options.redirect, "manual");
      return new Response("PRIVATE_PROVIDER_BODY", { status, headers: { location: "https://evil.example/" } });
    } });
    const { rpc } = await call(server, "clova_speech_submit_async", args);
    safeFailure(rpc);
    assert.equal(calls, 1);
    assert.match(rpc.result.content[0].text, /Do not automatically resubmit/);
  }
});

test("network failures and deadline remain uncertain without logging or retry", async () => {
  for (const stalled of [false, true]) {
    let calls = 0;
    const server = createWorker({ timeoutMs: 10, fetchImpl: async (_, options) => {
      calls++;
      if (!stalled) throw new Error("PRIVATE_PROVIDER_BODY " + env.NCLOUD_SPEECH_SECRET);
      await new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new Error())));
    } });
    const { rpc } = await call(server, "clova_speech_submit_async", args);
    safeFailure(rpc);
    assert.equal(calls, 1);
    assert.match(rpc.result.content[0].text, /Do not automatically resubmit/);
  }
});

test("response byte limits and invalid JSON are safe uncertain submission failures", async () => {
  for (const value of ["not json PRIVATE_PROVIDER_BODY", "x".repeat(LIMITS.responseBytes + 1)]) {
    const server = createWorker({ fetchImpl: async () => new Response(value) });
    const { rpc } = await call(server, "clova_speech_submit_async", args);
    safeFailure(rpc);
    assert.match(rpc.result.content[0].text, /Do not automatically resubmit/);
  }
});

test("request byte limit handles declared and streamed sizes and invalid JSON", async () => {
  const server = createWorker({ fetchImpl: noNetwork });
  const oversized = "x".repeat(LIMITS.requestBytes + 1);
  for (const headers of [{ "Content-Type": "application/json" },
    { "Content-Type": "application/json", "Content-Length": String(oversized.length) }]) {
    const result = await server.fetch(new Request("https://adapter.example.com/mcp",
      { method: "POST", headers, body: oversized }));
    assert.equal(result.status, 400);
    assert.ok(!await result.text().then((text) => text.includes(oversized)));
  }
  const bad = await server.fetch(request("tools/list", null, { body: "not-json" }));
  assert.equal(bad.status, 400);
});

test("only POST JSON /mcp is exposed; no secret intake, uploads, OAuth or local file endpoints", async () => {
  const server = createWorker({ fetchImpl: noNetwork });
  for (const path of ["/", "/upload", "/settings", "/secrets", "/callback", "/mcp?token=synthetic"]) {
    assert.equal((await server.fetch(new Request("https://adapter.example.com" + path))).status, 404);
  }
  assert.equal((await server.fetch(new Request("https://adapter.example.com/mcp"))).status, 405);
  assert.equal((await server.fetch(new Request("https://adapter.example.com/mcp", {
    method: "POST", body: "{}", headers: { "Content-Type": "text/plain" },
  }))).status, 415);
  const unknown = await (await server.fetch(request("unknown"))).json();
  assert.equal(unknown.error.code, -32601);
  const batch = await server.fetch(request("tools/list", null, { body: "[]" }));
  assert.equal(batch.status, 400);
  assert.equal(typeof worker.fetch, "function");
});

test("source manifest is MCP-only without project identity or persistence bindings", async () => {
  const manifest = JSON.parse(await readFile(new URL("../.openai/hosting.json", import.meta.url)));
  assert.deepEqual(manifest, { d1: null, r2: null, capabilities: ["mcp"] });
});

test("normalization matches the same provider-only contract used by Python", async () => {
  const contract = JSON.parse(await readFile(new URL("../../../contracts/clova-speech-v1.json", import.meta.url)));
  assert.equal(contract.contract_version, 1);
  for (const fixture of contract.cases) {
    assert.deepEqual(normalize(fixture.provider, fixture.require_token), fixture.normalized, fixture.name);
  }
});
