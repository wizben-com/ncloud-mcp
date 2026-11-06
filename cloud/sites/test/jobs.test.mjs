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
  owner = "synthetic-owner", rpcId = 1) {
  const response = await worker.fetch(new Request("https://adapter.example.com/mcp", {
    method: "POST", headers: { "Content-Type": "application/json", "oai-authenticated-user-id": owner },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method: "tools/call", params: { name, arguments: input } }),
  }), env);
  const serialized = await response.text();
  assert.ok(new TextEncoder().encode(serialized).byteLength <= LIMITS.rpcResponseBytes);
  for (const value of [accepted.token, base.NCLOUD_SPEECH_SECRET, base.NCLOUD_SPEECH_INVOKE_URL,
    args.location]) assert.ok(!serialized.includes(value), "Private provider values must not escape");
  return { ...JSON.parse(serialized).result, serialized };
}
const job = (result) => result.structuredContent.job_id;

test("concurrent, sequential and fresh-Worker duplicate delivery makes one POST", async () => {
  const settings = { ...base, DB: db() };
  let posts = 0;
  const fetchImpl = async () => { posts++; await new Promise((r) => setTimeout(r, 5));
    return Response.json(accepted); };
  const first = server(fetchImpl);
  const [a, b] = await Promise.all([call(first, settings), call(first, settings)]);
  assert.equal(job(a), job(b));
  assert.equal(posts, 1);
  const c = await call(server(noNetwork), settings, undefined,
    { ...args, language: "ko-KR", diarization: true }, undefined, 99);
  assert.equal(job(c), job(a));
  assert.deepEqual(Object.keys(c.structuredContent).sort(), ["job_id", "submission_state"]);
  assert.equal(c.structuredContent.submission_state, "ACCEPTED");
  const row = settings.DB.sqlite.prepare("SELECT * FROM ncloud_speech_jobs").get();
  assert.equal(row.upstream_token, accepted.token);
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
