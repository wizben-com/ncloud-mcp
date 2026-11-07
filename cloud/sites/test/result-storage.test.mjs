import assert from "node:assert/strict";
import test from "node:test";
import { storageConfiguration, fetchResultObject, signResultObjectGet, resultKeyForToken,
  MAX_RESULT_OBJECT_BYTES, RESULT_STORAGE_HOST } from "../worker/result-storage.js";

const env = {
  NCLOUD_SPEECH_RESULT_STORAGE_ENABLED: "true",
  NCLOUD_SPEECH_RESULT_BUCKET: "synthetic-results",
  NCLOUD_SPEECH_RESULT_PREFIX: "results/",
  NCLOUD_SPEECH_RESULT_ACCESS_KEY: "SYNTHETIC_ACCESS_KEY",
  NCLOUD_SPEECH_RESULT_SECRET_KEY: "SYNTHETIC_SECRET_KEY",
};
const config = storageConfiguration(env);
const noNetwork = () => assert.fail("No network allowed");
globalThis.fetch = noNetwork;

function sanitized(error) {
  assert.match(error.message, /^RESULT_STORAGE_[A-Z_]+:/);
  for (const value of [env.NCLOUD_SPEECH_RESULT_ACCESS_KEY, env.NCLOUD_SPEECH_RESULT_SECRET_KEY,
    "PRIVATE_PROVIDER_ERROR", "results/test.json", RESULT_STORAGE_HOST]) assert.ok(!error.message.includes(value));
  return true;
}

test("storage defaults disabled and does not read credentials", () => {
  assert.deepEqual(storageConfiguration(), { enabled: false, configured: false, bucketRootAllowed: false });
  assert.deepEqual(storageConfiguration({get NCLOUD_SPEECH_RESULT_SECRET_KEY() { throw Error("must not read"); }}),
    { enabled: false, configured: false, bucketRootAllowed: false });
  assert.equal(config.configured, true);
  assert.ok(!JSON.stringify(config).includes("SYNTHETIC_ACCESS_KEY"));
  assert.ok(!JSON.stringify(config).includes("SYNTHETIC_SECRET_KEY"));
  assert.equal(storageConfiguration({ ...env, NCLOUD_SPEECH_RESULT_PREFIX: "" }).configured, false);
  assert.throws(() => storageConfiguration({ ...env, NCLOUD_SPEECH_RESULT_STORAGE_ENABLED: "yes" }), sanitized);
});

test("configuration requires bounded bucket, restricted prefix and credential values", () => {
  for (const overrides of [
    { NCLOUD_SPEECH_RESULT_BUCKET: "https://evil.example" },
    { NCLOUD_SPEECH_RESULT_BUCKET: "127.0.0.1" },
    { NCLOUD_SPEECH_RESULT_PREFIX: "/" },
    { NCLOUD_SPEECH_RESULT_PREFIX: "results" },
    { NCLOUD_SPEECH_RESULT_PREFIX: "results/../" },
    { NCLOUD_SPEECH_RESULT_PREFIX: "results/%2e%2e/" },
    { NCLOUD_SPEECH_RESULT_ACCESS_KEY: "evil/key" },
    { NCLOUD_SPEECH_RESULT_SECRET_KEY: "secret\nkey" },
    { NCLOUD_SPEECH_RESULT_SECRET_KEY: "x".repeat(4097) },
  ]) assert.throws(() => storageConfiguration({ ...env, ...overrides }), sanitized);
});

test("known SigV4 vector matches independent Python HMAC result", async () => {
  const signed = await signResultObjectGet("results/test.json", config, new Date("2026-11-07T01:02:03Z"));
  assert.equal(signed.url, "https://kr.object.ncloudstorage.com/synthetic-results/results/test.json");
  assert.equal(signed.headers["x-amz-date"], "20261107T010203Z");
  assert.equal(signed.headers.Authorization,
    "AWS4-HMAC-SHA256 Credential=SYNTHETIC_ACCESS_KEY/20261107/kr-standard/s3/aws4_request, " +
    "SignedHeaders=host;x-amz-content-sha256;x-amz-date, " +
    "Signature=e6ec820fe4f645c8c7b51b75fa77192f3cd64d2040f04bc1014a7a3a7ebda454");
});

test("only fixed-host GET, safe path encoding, no cookies, no redirects", async () => {
  let calls = 0;
  const result = await fetchResultObject("results/한 글!'().json", config, async (url, init) => {
    calls++;
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://kr.object.ncloudstorage.com");
    assert.equal(parsed.pathname, "/synthetic-results/results/%ED%95%9C%20%EA%B8%80%21%27%28%29.json");
    assert.equal(init.method, "GET"); assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "manual"); assert.equal(init.body, undefined);
    assert.equal(init.headers.Cookie, undefined);
    return Response.json({ result: "COMPLETED", token: "synthetic-provider-token", text: "Synthetic result" });
  });
  assert.equal(calls, 1); assert.equal(result.text, "Synthetic result");
});

test("out-of-prefix, traversal and URL-like keys never fetch", async () => {
  for (const key of ["other/test.json", "results-other/a", "results/", "/results/test.json",
    "results/../secret", "results//test.json", "results/%2e%2e/secret", "results/a?versionId=x",
    "results/a#x", "results/a\\b", "results/a\u0000b", "https://evil.example/a", "results/\ud800",
    "results/" + "x".repeat(1024)]) await assert.rejects(fetchResultObject(key, config, noNetwork), sanitized);
  await assert.rejects(fetchResultObject("results/test.json", storageConfiguration(), noNetwork), sanitized);
});

test("template is optional, operator supplied and scoped with exactly one token", () => {
  assert.equal(resultKeyForToken(config, "SYNTHETIC"), null);
  const templated = storageConfiguration({ ...env, NCLOUD_SPEECH_RESULT_KEY_TEMPLATE: "results/{token}.json" });
  assert.equal(resultKeyForToken(templated, "synthetic-token"), "results/synthetic-token.json");
  for (const template of ["other/{token}.json", "results/{token}/{token}", "results/{other}",
    "results/test.json", "results/{token}/../x", "results/{token}?x=1"]) {
    assert.throws(() => storageConfiguration({ ...env, NCLOUD_SPEECH_RESULT_KEY_TEMPLATE: template }), sanitized);
  }
  for (const token of ["../a", "token\n", "x".repeat(257)]) assert.throws(() => resultKeyForToken(templated, token), sanitized);
});

test("redirect, upstream, JSON and stream failures are sanitized, with no retry", async () => {
  for (const response of [
    () => new Response("PRIVATE_PROVIDER_ERROR", { status: 403 }),
    () => new Response(null, { status: 307, headers: { Location: "https://evil.example" } }),
    () => new Response("PRIVATE_PROVIDER_ERROR"),
    () => new Response("[]"),
    () => new Response(new Uint8Array([0xff, 0xff])),
    () => new Response(new ReadableStream({ start(c) { c.error(Error("PRIVATE_PROVIDER_ERROR")); } })),
  ]) {
    let calls = 0;
    await assert.rejects(fetchResultObject("results/test.json", config, async () => { calls++; return response(); }), sanitized);
    assert.equal(calls, 1);
  }
  await assert.rejects(fetchResultObject("results/test.json", config, async () => { throw Error("PRIVATE_PROVIDER_ERROR"); }), sanitized);
});

test("declared and streamed object size is bounded", async () => {
  for (const response of [
    () => new Response("{}", { headers: { "Content-Length": String(MAX_RESULT_OBJECT_BYTES + 1) } }),
    () => new Response("{}", { headers: { "Content-Length": "not-a-number" } }),
    () => new Response(new Uint8Array(MAX_RESULT_OBJECT_BYTES + 1)),
  ]) await assert.rejects(fetchResultObject("results/test.json", config, async () => response()),
    (error) => sanitized(error) && /TOO_LARGE/.test(error.message));
});

test("aborted operations do not fetch or return a late result", async () => {
  await assert.rejects(fetchResultObject("results/test.json", config, noNetwork, AbortSignal.abort()), sanitized);
  const controller = new AbortController();
  let resolveFetch;
  const pending = fetchResultObject("results/test.json", config, async () =>
    new Promise((resolve) => { resolveFetch = resolve; }), controller.signal);
  while (!resolveFetch) await new Promise((resolve) => setTimeout(resolve, 1));
  controller.abort();
  await assert.rejects(pending, sanitized);
  resolveFetch(Response.json({ text: "Late content" }));
});


test("bucket-root access requires the exact explicit flag and remains read-only", async () => {
  const rootEnv = { ...env, NCLOUD_SPEECH_RESULT_PREFIX: "" };
  for (const flag of [undefined, "false"]) {
    const denied = storageConfiguration({ ...rootEnv, NCLOUD_SPEECH_RESULT_ALLOW_BUCKET_ROOT: flag });
    assert.equal(denied.configured, false);
    assert.equal(denied.bucketRootAllowed, false);
    await assert.rejects(fetchResultObject("test.json", denied, noNetwork), sanitized);
    assert.throws(() => storageConfiguration({ ...rootEnv, NCLOUD_SPEECH_RESULT_ALLOW_BUCKET_ROOT: flag,
      NCLOUD_SPEECH_RESULT_KEY_TEMPLATE: "{token}.json" }), sanitized);
  }
  for (const flag of [true, "TRUE", "yes", ""]) assert.throws(() => storageConfiguration({
    ...rootEnv, NCLOUD_SPEECH_RESULT_ALLOW_BUCKET_ROOT: flag }), sanitized);
  const root = storageConfiguration({ ...rootEnv, NCLOUD_SPEECH_RESULT_ALLOW_BUCKET_ROOT: "true",
    NCLOUD_SPEECH_RESULT_KEY_TEMPLATE: "{token}.json" });
  assert.equal(root.configured, true);
  assert.equal(root.bucketRootAllowed, true);
  assert.equal(resultKeyForToken(root, "synthetic-token"), "synthetic-token.json");
  let calls = 0;
  await fetchResultObject("synthetic-token.json", root, async (url, init) => {
    calls++;
    assert.equal(url, "https://kr.object.ncloudstorage.com/synthetic-results/synthetic-token.json");
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "manual");
    return Response.json({ token: "synthetic-token" });
  });
  assert.equal(calls, 1);
  for (const key of ["", "/", "/test.json", "../test.json", "a/../test.json", "a//b", "a%2fb",
    "a?x=1", "a#fragment", "https://evil.example/a", "a\\b", "a\u0000b"]) {
    await assert.rejects(fetchResultObject(key, root, noNetwork), sanitized);
  }
  for (const template of ["../{token}.json", "/{token}.json", "{token}?x=1"]) {
    assert.throws(() => storageConfiguration({ ...rootEnv, NCLOUD_SPEECH_RESULT_ALLOW_BUCKET_ROOT: "true",
      NCLOUD_SPEECH_RESULT_KEY_TEMPLATE: template }), sanitized);
  }
  // Even an explicit root flag does not widen a configured nonempty prefix.
  const prefixed = storageConfiguration({ ...env, NCLOUD_SPEECH_RESULT_ALLOW_BUCKET_ROOT: "true" });
  await assert.rejects(fetchResultObject("test.json", prefixed, noNetwork), sanitized);
  assert.throws(() => storageConfiguration({ ...env, NCLOUD_SPEECH_RESULT_ALLOW_BUCKET_ROOT: "true",
    NCLOUD_SPEECH_RESULT_KEY_TEMPLATE: "{token}.json" }), sanitized);
});


test("verified filename templates accept only saved opaque supported audio filenames", () => {
  const filename = "audio_12345678-1234-1234-1234-123456789abc.wav";
  const templated = storageConfiguration({ ...env,
    NCLOUD_SPEECH_RESULT_KEY_TEMPLATE: "results/{token}/{filename}.json" });
  assert.equal(resultKeyForToken(templated, "token", filename), `results/token/${filename}.json`);
  assert.equal(resultKeyForToken(templated, "token"), null);
  assert.equal(resultKeyForToken(templated, "token", null), null);
  for (const extension of ["wav", "mp3", "ogg", "flac", "m4a", "mp4", "aac", "ac3", "WAV"]) {
    const name = filename.replace(/wav$/, extension);
    assert.equal(resultKeyForToken(templated, "token", name), `results/token/${name}.json`);
  }
  for (const name of ["", "meeting.wav", "audio_token.wav", filename + "\n", "../" + filename,
    "folder/" + filename, filename.replace(".wav", ".exe"), filename + "?x", filename + "#x", 123]) {
    assert.throws(() => resultKeyForToken(templated, "token", name), sanitized);
  }
  for (const template of ["results/{filename}.json", "results/{token}/{filename}/{filename}",
    "results/{token}/{filename}/{other}", "results/{token}/../{filename}", "{token}/{filename}"]) {
    assert.throws(() => storageConfiguration({ ...env, NCLOUD_SPEECH_RESULT_KEY_TEMPLATE: template }), sanitized);
  }
  const rootEnv = { ...env, NCLOUD_SPEECH_RESULT_PREFIX: "",
    NCLOUD_SPEECH_RESULT_KEY_TEMPLATE: "{filename}_{token}.json" };
  assert.throws(() => storageConfiguration(rootEnv), sanitized);
  const root = storageConfiguration({ ...rootEnv, NCLOUD_SPEECH_RESULT_ALLOW_BUCKET_ROOT: "true" });
  assert.equal(resultKeyForToken(root, "token", filename), `${filename}_token.json`);
  const tokenOnly = storageConfiguration({ ...env, NCLOUD_SPEECH_RESULT_KEY_TEMPLATE: "results/{token}.json" });
  assert.equal(resultKeyForToken(tokenOnly, "token"), "results/token.json");
});
