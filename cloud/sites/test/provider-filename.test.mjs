import assert from "node:assert/strict";
import test from "node:test";
import { createWorker } from "../worker/index.js";
import { SqliteD1, migrations, seedAccepted } from "./sqlite-d1.mjs";

globalThis.fetch = () => { throw Error("No live network"); };
const env = { NCLOUD_SPEECH_ENABLED: "true",
  NCLOUD_SPEECH_INVOKE_URL: "https://clovaspeech-gw.ncloud.com/external/v1/0000/SYNTHETIC",
  NCLOUD_SPEECH_SECRET: "SYNTHETIC_SECRET", NCLOUD_SPEECH_UPLOAD_URL_HOSTS: "media.example.com",
  NCLOUD_SPEECH_ALLOW_ASYNC_OBS: "true", NCLOUD_SPEECH_RESULT_STORAGE_ENABLED: "true",
  NCLOUD_SPEECH_RESULT_BUCKET: "synthetic-results", NCLOUD_SPEECH_RESULT_PREFIX: "results/",
  NCLOUD_ACCOUNT_ACCESS_KEY: "SYNTHETIC_ACCESS", NCLOUD_ACCOUNT_SECRET_KEY: "SYNTHETIC_SECRET",
  NCLOUD_SPEECH_RESULT_KEY_TEMPLATE: "results/{filename}_{token}.json" };
const args = { request_id: "filename-test-001", source: "upload_url", filename: "private-meeting.OGG",
  location: "https://media.example.com/synthetic", result_to_obs: true };
async function call(worker, bindings, name, input) {
  return (await (await worker.fetch(new Request("https://site.example/mcp", {
    method: "POST", headers: { "content-type": "application/json", "oai-authenticated-user-id": "synthetic-owner" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: input } }),
  }), bindings)).json()).result;
}

test("opaque upload filename is durable before POST, private and stable across duplicate delivery", async () => {
  const DB = new SqliteD1(); let posts = 0, mediaGets = 0, storedName;
  try {
    const settings = { ...env, DB };
    const worker = createWorker({ fetchImpl: async (url, options) => {
      if (url.includes("media.example.com")) { mediaGets++; return new Response(new TextEncoder().encode("OggSsynthetic")); }
      if (options.method === "POST") {
        posts++;
        const row = DB.sqlite.prepare("SELECT * FROM ncloud_speech_jobs").get();
        storedName = row.provider_filename;
        assert.equal(storedName, "audio_" + row.job_id.slice(4) + ".ogg");
        assert.equal(options.body.get("media").name, storedName);
        assert.equal(row.submission_state, "SUBMITTING");
        assert.ok(!JSON.stringify(row).includes(args.filename));
        return Response.json({ result: "SUCCEEDED", token: "synthetic-token" });
      }
      assert.equal(options.method, "GET");
      if (url.includes("/recognizer/")) return Response.json({ result: "COMPLETED", segments: [] });
      assert.ok(url.endsWith("/results/" + storedName + "_synthetic-token.json"));
      return Response.json({ result: "SUCCEEDED", token: "synthetic-token", text: "Recovered privately" });
    } });
    const first = await call(worker, settings, "clova_speech_submit_async", args);
    assert.equal(first.isError, false, JSON.stringify(first));
    const duplicate = await call(createWorker({ fetchImpl: () => assert.fail("Duplicate cannot fetch") }),
      settings, "clova_speech_submit_async", args);
    assert.equal(duplicate.structuredContent.job_id, first.structuredContent.job_id);
    assert.equal(posts, 1); assert.equal(mediaGets, 1);
    const result = await call(worker, settings, "clova_speech_job_result_page", { job_id: first.structuredContent.job_id });
    assert.equal(result.isError, false); assert.equal(result.structuredContent.text, "Recovered privately");
    assert.ok(!JSON.stringify([first, duplicate, result]).includes(storedName));
    assert.ok(!JSON.stringify([first, duplicate, result]).includes(args.filename));
    const changed = await call(worker, settings, "clova_speech_submit_async", { ...args, filename: "different.ogg" });
    assert.match(changed.content[0].text, /REQUEST_ID_CONFLICT/); assert.equal(posts, 1);
  } finally { DB.close(); }
});

test("legacy null filename permits explicit keys and token-only templates without submission", async () => {
  const DB = new SqliteD1();
  try {
    const settings = { ...env, DB }, job_id = await seedAccepted(settings);
    assert.equal(DB.sqlite.prepare("SELECT provider_filename FROM ncloud_speech_jobs").get().provider_filename, null);
    let gets = 0;
    const worker = createWorker({ fetchImpl: async (url, options) => {
      gets++; assert.equal(options.method, "GET");
      return Response.json(url.includes("/recognizer/") ? { result: "COMPLETED", segments: [] }
        : { result: "SUCCEEDED", token: "synthetic-token", text: "Legacy recovered" });
    } });
    const absent = await call(worker, settings, "clova_speech_job_result_page", { job_id });
    assert.equal(absent.isError, true); assert.equal(gets, 1);
    const explicit = await call(worker, settings, "clova_speech_job_result_page", { job_id, object_key: "results/legacy.json" });
    assert.equal(explicit.isError, false);
    const fixed = await call(worker, { ...settings, NCLOUD_SPEECH_RESULT_KEY_TEMPLATE: "results/{token}.json" },
      "clova_speech_job_result_page", { job_id });
    assert.equal(fixed.isError, false); assert.equal(fixed.structuredContent.text, "Legacy recovered");
  } finally { DB.close(); }
});

test("additive migration keeps historical job data and defaults provider filename to null", () => {
  const DB = new SqliteD1({ migrate: false });
  try {
    DB.sqlite.exec(migrations[0]);
    DB.sqlite.prepare(`INSERT INTO ncloud_speech_jobs
      (job_id,owner_id,request_id,provider_scope,payload_hash,submission_state,created_at)
      VALUES (?,?,?,?,?,'SUBMITTING',0)`).run("job_" + crypto.randomUUID(), "owner", "legacy-request", "0".repeat(64), "1".repeat(64));
    for (const migration of migrations.slice(1)) DB.sqlite.exec(migration);
    const row = DB.sqlite.prepare("SELECT * FROM ncloud_speech_jobs").get();
    assert.equal(row.request_id, "legacy-request"); assert.equal(row.provider_filename, null);
  } finally { DB.close(); }
});

test("uncertain POST retains opaque filename and duplicate delivery never retries", async () => {
  const DB = new SqliteD1(); let posts = 0;
  try {
    const settings = { ...env, DB };
    const worker = createWorker({ fetchImpl: async (_, options) => {
      if (options.method === "GET") return new Response(new TextEncoder().encode("OggSsynthetic"));
      posts++; throw Error("Synthetic lost acknowledgment");
    } });
    const first = await call(worker, settings, "clova_speech_submit_async", args);
    assert.equal(first.isError, true);
    const row = DB.sqlite.prepare("SELECT * FROM ncloud_speech_jobs").get();
    assert.equal(row.provider_filename, "audio_" + row.job_id.slice(4) + ".ogg");
    assert.equal(row.submission_state, "UNKNOWN");
    const duplicate = await call(worker, settings, "clova_speech_submit_async", args);
    assert.equal(duplicate.structuredContent.job_id, row.job_id); assert.equal(posts, 1);
    assert.equal(DB.sqlite.prepare("SELECT provider_filename FROM ncloud_speech_jobs").get().provider_filename, row.provider_filename);
  } finally { DB.close(); }
});
