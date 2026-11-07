import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorker, SQL, LIMITS } from "../worker/index.js";
import { SqliteD1, seedAccepted } from "./sqlite-d1.mjs";

globalThis.fetch = () => { throw new Error("Live network forbidden"); };
const connections = [], directories = [];
afterEach(() => {
  for (const db of connections.splice(0)) db.close();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function db(options) { const value = new SqliteD1(options); connections.push(value); return value; }
const base = { NCLOUD_SPEECH_ENABLED: "true",
  NCLOUD_SPEECH_INVOKE_URL: "https://clovaspeech-gw.ncloud.com/external/v1/0000/SYNTHETIC",
  NCLOUD_SPEECH_SECRET: "SYNTHETIC_TEST_SECRET", NCLOUD_SPEECH_URL_HOSTS: "media.example.com",
  NCLOUD_SPEECH_ALLOW_ASYNC_OBS: "true" };
const args = { request_id: "request-synthetic-1", source: "url",
  location: "https://media.example.com/synthetic.wav", result_to_obs: true };
const accepted = { result: "SUCCEEDED", token: "synthetic-token" };
const noNetwork = () => assert.fail("Provider must not be called");
function server(fetchImpl = noNetwork, timeoutMs = 10_000) { return createWorker({ fetchImpl, timeoutMs }); }
async function call(worker, env, name = "clova_speech_submit_async", input = args,
  owner = "synthetic-owner", rpcId = 1, metadata = undefined) {
  const response = await worker.fetch(new Request("https://adapter.example.com/mcp", {
    method: "POST", headers: { "Content-Type": "application/json", "oai-authenticated-user-id": owner },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method: "tools/call", params: { name, arguments: input,
      ...(metadata === undefined ? {} : { _meta: metadata }) } }),
  }), env);
  const serialized = await response.text();
  assert.ok(new TextEncoder().encode(serialized).byteLength <= LIMITS.rpcResponseBytes);
  for (const value of [accepted.token, base.NCLOUD_SPEECH_SECRET, base.NCLOUD_SPEECH_INVOKE_URL,
    args.location]) assert.ok(!serialized.includes(value), "Private provider values must not escape");
  const result = JSON.parse(serialized).result;
  assert.equal(result.resultType, "complete");
  return { ...result, serialized };
}
const job = (result) => result.structuredContent.job_id;

test("concurrent, sequential and fresh-Worker duplicate delivery makes one POST", async () => {
  const settings = { ...base, DB: db() };
  let posts = 0;
  const fetchImpl = async (_, options) => {
    assert.ok(!JSON.stringify(options).includes("SYNTHETIC_TRANSPORT_META"));
    posts++; await new Promise((r) => setTimeout(r, 5));
    return Response.json(accepted); };
  const first = server(fetchImpl);
  const [a, b] = await Promise.all([
    call(first, settings, undefined, args, undefined, 1, { trace: "SYNTHETIC_TRANSPORT_META_A",
      "oai-authenticated-user-id": "synthetic-other-owner", request_id: "SYNTHETIC_TRANSPORT_META_REPLACEMENT" }),
    call(first, settings, undefined, args, undefined, 1, { progressToken: "SYNTHETIC_TRANSPORT_META_B" }),
  ]);
  assert.equal(job(a), job(b));
  assert.equal(posts, 1);
  const c = await call(server(noNetwork), settings, undefined,
    { ...args, language: "ko-KR", diarization: true }, undefined, 99);
  assert.equal(job(c), job(a));
  assert.deepEqual(Object.keys(c.structuredContent).sort(), ["job_id", "submission_state"]);
  assert.equal(c.structuredContent.submission_state, "ACCEPTED");
  const row = settings.DB.sqlite.prepare("SELECT * FROM ncloud_speech_jobs").get();
  assert.equal(row.upstream_token, accepted.token);
  assert.equal(row.owner_id, "synthetic-owner");
  assert.equal(row.request_id, args.request_id);
  assert.ok(!JSON.stringify(row).includes("SYNTHETIC_TRANSPORT_META"));
  for (const value of [base.NCLOUD_SPEECH_SECRET, base.NCLOUD_SPEECH_INVOKE_URL, args.location]) {
    assert.ok(!JSON.stringify(row).includes(value));
  }
});

test("SQLite UNIQUE claim persists across connections; UNKNOWN correction cannot clobber a token", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ncloud-ledger-")); directories.push(directory);
  const filename = join(directory, "synthetic.sqlite");
  const a = db({ filename }), b = db({ filename, migrate: false });
  const id = "job_" + crypto.randomUUID();
  const values = [id, "synthetic-owner", args.request_id, "0".repeat(64), "1".repeat(64), 0];
  assert.equal((await a.prepare(SQL.claim).bind(...values).run()).meta.changes, 1);
  assert.equal((await b.prepare(SQL.claim).bind("job_" + crypto.randomUUID(), ...values.slice(1)).run()).meta.changes, 0);
  // Simulate the crash window: a new Worker sees the durable SUBMITTING tombstone.
  const scope = Buffer.from(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(base.NCLOUD_SPEECH_INVOKE_URL))).toString("hex");
  b.sqlite.prepare("UPDATE ncloud_speech_jobs SET provider_scope = ?").run(scope);
  const status = await call(server(), { ...base, DB: b }, "clova_speech_job_status", { job_id: id });
  assert.equal(status.structuredContent.submission_state, "SUBMITTING");
  // A partial/uncertain write with a token must survive UNKNOWN repair as well.
  b.sqlite.prepare("UPDATE ncloud_speech_jobs SET upstream_token = ?").run(accepted.token);
  assert.equal((await a.prepare(SQL.unknown).bind(id, "synthetic-owner").run()).meta.changes, 0);
  assert.equal(b.sqlite.prepare("SELECT upstream_token FROM ncloud_speech_jobs").get().upstream_token, accepted.token);
});

test("same request_id conflicts on changed payload; different owner has independent claim", async () => {
  const settings = { ...base, DB: db() };
  let posts = 0;
  const worker = server(async () => { posts++; return Response.json(accepted); });
  const first = await call(worker, settings);
  const conflict = await call(worker, settings, undefined, { ...args, diarization: false });
  assert.equal(conflict.isError, true);
  assert.match(conflict.content[0].text, /REQUEST_ID_CONFLICT/);
  assert.equal(posts, 1);
  const other = await call(worker, settings, undefined, args, "synthetic-other-owner");
  assert.notEqual(job(first), job(other));
  assert.equal(posts, 2);
});

test("missing binding/migration, failed or uncertain claim causes zero POSTs", async () => {
  const broken = db();
  broken.beforeRun = () => { throw new Error("synthetic outage"); };
  const uncertain = db();
  uncertain.afterRun = (sql) => { if (sql === SQL.claim) throw new Error("lost acknowledgment"); };
  for (const DB of [undefined, db({ migrate: false }), broken, uncertain]) {
    const result = await call(server(), { ...base, DB });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /JOB_STORE_UNAVAILABLE/);
  }
  uncertain.afterRun = undefined;
  const duplicate = await call(server(), { ...base, DB: uncertain });
  assert.equal(duplicate.structuredContent.submission_state, "SUBMITTING");
});

test("timeout or token-save uncertainty retains tombstones and never resubmits", async () => {
  for (const fault of ["timeout", "save-before-commit", "save-after-commit", "confirmation-read", "save-and-repair-outage"]) {
    const DB = db(), settings = { ...base, DB };
    if (fault.includes("before") || fault === "save-and-repair-outage") DB.beforeRun = (sql) => {
      if (sql === SQL.accepted || (fault === "save-and-repair-outage" && sql === SQL.unknown)) throw new Error();
    };
    if (fault === "save-after-commit") DB.afterRun = (sql) => { if (sql === SQL.accepted) throw new Error(); };
    if (fault === "confirmation-read") DB.beforeRead = (sql) => { if (sql === SQL.owned) throw new Error(); };
    let posts = 0;
    const worker = server(async (_, options) => {
      posts++;
      if (fault === "timeout") await new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new Error())));
      return Response.json(accepted);
    }, 10);
    const result = await call(worker, settings);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.submission_state, "UNKNOWN");
    assert.match(result.content[0].text, /Do not automatically resubmit/);
    DB.beforeRun = undefined; DB.afterRun = undefined; DB.beforeRead = undefined;
    const duplicate = await call(server(), settings);
    assert.equal(job(duplicate), job(result));
    const expected = ["save-after-commit", "confirmation-read"].includes(fault) ? "ACCEPTED" : fault === "save-and-repair-outage" ? "SUBMITTING" : "UNKNOWN";
    assert.equal(duplicate.structuredContent.submission_state, expected);
    assert.equal(posts, 1);
    if (expected !== "ACCEPTED") {
      const state = await call(server(), settings, "clova_speech_job_status", { job_id: job(result) });
      assert.equal(state.structuredContent.submission_state, expected);
    }
  }
});

test("wrong owner and missing jobs have identical denial; changed domain never receives old token", async () => {
  const settings = { ...base, DB: db() };
  const id = await seedAccepted(settings);
  const wrong = await call(server(), settings, "clova_speech_job_status", { job_id: id }, "synthetic-other-owner");
  const missing = await call(server(), settings, "clova_speech_job_status", { job_id: "job_" + crypto.randomUUID() });
  assert.deepEqual(wrong.content, missing.content);
  assert.match(wrong.content[0].text, /JOB_NOT_FOUND/);
  const changed = { ...settings, NCLOUD_SPEECH_INVOKE_URL: base.NCLOUD_SPEECH_INVOKE_URL + "_CHANGED" };
  const scope = await call(server(), changed, "clova_speech_job_status", { job_id: id });
  assert.match(scope.content[0].text, /PROVIDER_SCOPE_CHANGED/);
  await call(server(async () => Response.json(accepted)), settings);
  const conflict = await call(server(), changed);
  assert.equal(conflict.isError, true);
  assert.match(conflict.content[0].text, /REQUEST_ID_CONFLICT/);
});

test("final serialized/escaped response cap prevents normalized amplification without losing accepted job", async () => {
  const settings = { ...base, DB: db() };
  const id = await seedAccepted(settings);
  const amplified = { result: "COMPLETED", segments: Array.from({ length: 90 }, () => ({
    start: 0, end: 1, text: "x", words: Array.from({ length: 1100 }, () => [0, 1, "x"]),
  })) };
  const providerBytes = new TextEncoder().encode(JSON.stringify(amplified)).byteLength;
  assert.ok(providerBytes > 950_000 && providerBytes < LIMITS.responseBytes);
  for (const result of [amplified, { result: "COMPLETED", text: "é".repeat(150_000) }]) {
    const output = await call(server(async (_, options) => {
      assert.equal(options.method, "GET"); return Response.json(result);
    }), settings, "clova_speech_job_status", { job_id: id });
    assert.equal(output.isError, true);
    assert.equal(output.structuredContent.error.code, "RESULT_TOO_LARGE");
    assert.equal(output.structuredContent.job_id, id);
    assert.equal(output.structuredContent.provider_state, "COMPLETED");
    assert.match(output.content[0].text, /do not re-transcribe/);
    const record = settings.DB.sqlite.prepare("SELECT * FROM ncloud_speech_jobs").get();
    assert.equal(record.submission_state, "ACCEPTED");
    assert.equal(record.upstream_token, accepted.token);
    assert.equal(record.provider_state, "COMPLETED");
    assert.ok(!JSON.stringify(record).includes("segments"));
  }
});

test("long result pages reconstruct Unicode text and segment slices without resubmission", async () => {
  const settings = { ...base, DB: db() }, id = await seedAccepted(settings);
  const text = "가😀\n\"".repeat(110_000);
  const segments = Array.from({ length: 201 }, (_, n) => ({ start: n, end: n + 1, text: String(n) }));
  let reads = 0;
  const worker = server(async (_, options) => {
    assert.equal(options.method, "GET"); reads++;
    return Response.json({ result: "COMPLETED", text, segments });
  });
  let offset = 0, assembled = "";
  do {
    const result = await call(worker, settings, "clova_speech_job_result_page", { job_id: id, offset });
    assert.equal(result.isError, false);
    const page = result.structuredContent;
    assert.equal(Array.from(page.text).length, page.count);
    assert.equal(page.total, Array.from(text).length);
    assembled += page.text; offset = page.next_offset;
  } while (offset !== null);
  assert.equal(assembled, text);
  const page = (await call(worker, settings, "clova_speech_job_result_page",
    { job_id: id, format: "segments", offset: 100, limit: 100 })).structuredContent;
  assert.equal(page.segments[0].text, "100");
  assert.equal(page.count, 100); assert.equal(page.next_offset, 200);
  assert.ok(reads > 1);
});

test("page bounds, owner, provider scope and zero/end offsets are enforced", async () => {
  const settings = { ...base, DB: db() }, id = await seedAccepted(settings);
  for (const input of [{ offset: -1 }, { offset: 0.5 }, { limit: 0 }, { limit: 16385 },
    { format: "segments", limit: 101 }, { format: "bad" }, { token: "bad" }]) {
    assert.equal((await call(server(), settings, "clova_speech_job_result_page", { job_id: id, ...input })).isError, true);
  }
  const wrong = await call(server(), settings, "clova_speech_job_result_page", { job_id: id }, "another-owner");
  assert.match(wrong.content[0].text, /JOB_NOT_FOUND/);
  const changed = await call(server(), { ...settings, NCLOUD_SPEECH_INVOKE_URL: base.NCLOUD_SPEECH_INVOKE_URL + "_CHANGED" },
    "clova_speech_job_result_page", { job_id: id });
  assert.match(changed.content[0].text, /PROVIDER_SCOPE_CHANGED/);
  const worker = server(async () => Response.json({ result: "COMPLETED", text: "😀" }));
  const end = await call(worker, settings, "clova_speech_job_result_page", { job_id: id, offset: 1 });
  assert.equal(end.structuredContent.text, ""); assert.equal(end.structuredContent.next_offset, null);
  assert.match((await call(worker, settings, "clova_speech_job_result_page", { job_id: id, offset: 2 })).content[0].text,
    /PAGE_OFFSET_OUT_OF_RANGE/);
});

test("provider oversize status is explicit, retained and never retried for headers or streams", async () => {
  const settings = { ...base, NCLOUD_SPEECH_MAX_RESULT_BYTES: String(LIMITS.responseBytes), DB: db() };
  const id = await seedAccepted(settings);
  for (const headers of [{}, { "Content-Length": String(LIMITS.responseBytes + 1) }]) {
    let reads = 0;
    const worker = server(async (_, options) => {
      reads++; assert.equal(options.method, "GET");
      return new Response("x".repeat(LIMITS.responseBytes + 1), { headers });
    });
    const result = await call(worker, settings, "clova_speech_job_result_page", { job_id: id });
    assert.match(result.content[0].text, /PROVIDER_RESULT_TOO_LARGE/);
    assert.equal(result.structuredContent.job_id, id); assert.equal(reads, 1);
    assert.match(result.content[0].text, /Do not re-transcribe/);
  }
});

test("segment pages shrink to final byte budget and explicitly reject a single oversized segment", async () => {
  const settings = { ...base, DB: db() }, id = await seedAccepted(settings);
  const segments = Array.from({ length: 20 }, (_, n) => ({ start: n, end: n + 1, text: "가".repeat(5000) }));
  const worker = server(async () => Response.json({ result: "COMPLETED", segments }));
  const result = await call(worker, settings, "clova_speech_job_result_page", { job_id: id, format: "segments" });
  assert.equal(result.isError, false); assert.ok(result.structuredContent.count < 20);
  const huge = server(async () => Response.json({ result: "COMPLETED", segments: [{ start: 0, end: 1, text: "x".repeat(140_000) }] }));
  const failure = await call(huge, settings, "clova_speech_job_result_page", { job_id: id, format: "segments" });
  assert.match(failure.content[0].text, /SEGMENT_TOO_LARGE/);
});
