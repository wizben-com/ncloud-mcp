/** Read-only NAVER Object Storage result access using portable Web Crypto/Fetch.
 * Restrict credentials to the narrowest bucket scope NAVER supports; the code also
 * enforces a configured prefix unless bucket-root access is explicitly enabled.
 * IAM prefix-scoping is not established by the docs.
 * This module cannot prove the permissions on a supplied key. No account-key fallback.
 * Caller MUST authenticate job ownership and match the returned provider token before use.
 */
export const RESULT_STORAGE_HOST = "kr.object.ncloudstorage.com";
export const RESULT_STORAGE_REGION = "kr-standard";
export const MAX_RESULT_OBJECT_BYTES = 16 * 1024 * 1024;
const READ_TIMEOUT_MS = 15_000;
const encoder = new TextEncoder();
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const SIGNED_HEADERS = "host;x-amz-content-sha256;x-amz-date";
const fail = (code) => new Error(`${code}: result storage operation unavailable; details suppressed.`);
const validCredential = (v) => typeof v === "string" && v.length > 0 && v.length <= 4096 && /^[\x21-\x7e]+$/.test(v);
const hex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
const encode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function validPath(value, maximum, prefix = false) {
  if (typeof value !== "string" || !value || encoder.encode(value).byteLength > maximum ||
      /[\x00-\x1f\x7f\\%?#]/.test(value) || value.startsWith("/") ||
      value.normalize("NFC") !== value) return false;
  if (prefix && !value.endsWith("/")) return false;
  const parts = (prefix ? value.slice(0, -1) : value).split("/");
  if (parts.some((p) => !p || p === "." || p === "..")) return false;
  try { encode(value); } catch { return false; }
  return true;
}
function validBucket(value) {
  return typeof value === "string" && value.length >= 3 && value.length <= 63 &&
    /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value) && !/\.\.|\.-|-\./.test(value) &&
    !/^\d+\.\d+\.\d+\.\d+$/.test(value);
}

// Templates are operator-verified layouts, never inferred from a provider response.
function validTemplate(template) {
  return typeof template === "string" && template.split("{token}").length === 2 &&
    template.split("{filename}").length <= 2 &&
    !/[{}]/.test(template.replace("{token}", "").replace("{filename}", ""));
}
const PROVIDER_FILENAME = /^audio_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:wav|mp3|ogg|flac|m4a|mp4|aac|ac3)$/i;

export function storageConfiguration(env = {}) {
  try {
    const flag = env.NCLOUD_SPEECH_RESULT_STORAGE_ENABLED ?? "false";
    if (flag !== "true" && flag !== "false") throw fail("RESULT_STORAGE_INVALID_CONFIGURATION");
    if (flag === "false") return Object.freeze({ enabled: false, configured: false, bucketRootAllowed: false });
    const rootFlag = env.NCLOUD_SPEECH_RESULT_ALLOW_BUCKET_ROOT ?? "false";
    if (rootFlag !== "true" && rootFlag !== "false") throw fail("RESULT_STORAGE_INVALID_CONFIGURATION");
    const bucketRootAllowed = rootFlag === "true";
    const bucket = env.NCLOUD_SPEECH_RESULT_BUCKET ?? "";
    const prefix = env.NCLOUD_SPEECH_RESULT_PREFIX ?? "";
    const keyTemplate = env.NCLOUD_SPEECH_RESULT_KEY_TEMPLATE ?? "";
    const accessKey = env.NCLOUD_ACCOUNT_ACCESS_KEY ?? "";
    const secretKey = env.NCLOUD_ACCOUNT_SECRET_KEY ?? "";
    if ((bucket !== "" && !validBucket(bucket)) ||
        (prefix !== "" && !validPath(prefix, 512, true)) ||
        (accessKey !== "" && (!validCredential(accessKey) || /[,\/]/.test(accessKey))) ||
        (secretKey !== "" && !validCredential(secretKey))) throw fail("RESULT_STORAGE_INVALID_CONFIGURATION");
    if (keyTemplate !== "" && (!validTemplate(keyTemplate) ||
        !validPath(keyTemplate.replace("{token}", "SYNTHETIC").replace("{filename}", "audio_00000000-0000-0000-0000-000000000000.wav"), 1024) || (!prefix && !bucketRootAllowed) ||
        !keyTemplate.startsWith(prefix))) throw fail("RESULT_STORAGE_INVALID_CONFIGURATION");
    const config = { enabled: true, configured: Boolean(bucket && (prefix || bucketRootAllowed) && accessKey && secretKey), bucket, prefix, keyTemplate, bucketRootAllowed };
    // Avoid accidental exposure through ordinary JSON/configuration diagnostics.
    Object.defineProperties(config, { accessKey: { value: accessKey }, secretKey: { value: secretKey } });
    return Object.freeze(config);
  } catch { throw fail("RESULT_STORAGE_INVALID_CONFIGURATION"); }
}

function validateRequest(key, config) {
  if (!config?.enabled) throw fail("RESULT_STORAGE_DISABLED");
  if (!config.configured) throw fail("RESULT_STORAGE_UNCONFIGURED");
  if (!validBucket(config.bucket) ||
      !(validPath(config.prefix, 512, true) || (config.prefix === "" && config.bucketRootAllowed === true)) ||
      !validCredential(config.accessKey) || /[,\/]/.test(config.accessKey) ||
      !validCredential(config.secretKey)) throw fail("RESULT_STORAGE_INVALID_CONFIGURATION");
  if (!validPath(key, 1024) || !key.startsWith(config.prefix) || key === config.prefix) {
    throw fail("RESULT_STORAGE_INVALID_KEY");
  }
}
export function resultKeyForToken(config, token, providerFilename = null) {
  if (!config?.keyTemplate) return null;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(token) || /[\r\n]/.test(token) ||
      !validTemplate(config.keyTemplate)) throw fail("RESULT_STORAGE_INVALID_KEY");
  let key = config.keyTemplate.replace("{token}", token);
  if (key.includes("{filename}")) {
    // Legacy jobs may not have a saved opaque filename. Do not guess one.
    if (providerFilename === null || providerFilename === undefined) return null;
    if (typeof providerFilename !== "string" || !PROVIDER_FILENAME.test(providerFilename) ||
        /[\r\n]/.test(providerFilename)) throw fail("RESULT_STORAGE_INVALID_KEY");
    key = key.replace("{filename}", providerFilename);
  }
  validateRequest(key, config);
  return key;
}
async function hmac(key, text) {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", imported, encoder.encode(text));
}
async function sha(text) { return hex(await crypto.subtle.digest("SHA-256", encoder.encode(text))); }

// Exported for deterministic offline signature vectors, not as a user-facing tool.
export async function signResultObjectGet(key, config, now = new Date()) {
  validateRequest(key, config);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw fail("RESULT_STORAGE_INVALID_DATE");
  const dateTime = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = dateTime.slice(0, 8);
  const path = `/${config.bucket}/${key.split("/").map(encode).join("/")}`;
  const canonicalHeaders = `host:${RESULT_STORAGE_HOST}\nx-amz-content-sha256:${EMPTY_SHA256}\nx-amz-date:${dateTime}\n`;
  const canonical = ["GET", path, "", canonicalHeaders, SIGNED_HEADERS, EMPTY_SHA256].join("\n");
  const scope = `${date}/${RESULT_STORAGE_REGION}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", dateTime, scope, await sha(canonical)].join("\n");
  let signingKey = await hmac(encoder.encode(`AWS4${config.secretKey}`), date);
  for (const part of [RESULT_STORAGE_REGION, "s3", "aws4_request"]) signingKey = await hmac(signingKey, part);
  const signature = hex(await hmac(signingKey, toSign));
  return {
    url: `https://${RESULT_STORAGE_HOST}${path}`,
    headers: {
      "x-amz-date": dateTime, "x-amz-content-sha256": EMPTY_SHA256,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`,
      Accept: "application/json",
    },
  };
}

async function boundedObject(response, signal) {
  const length = response.headers.get("content-length");
  if (response.status !== 200 || !response.body) {
    void response.body?.cancel().catch(() => {});
    throw fail("RESULT_STORAGE_READ_FAILED");
  }
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESULT_OBJECT_BYTES)) {
    void response.body.cancel().catch(() => {});
    throw fail("RESULT_STORAGE_TOO_LARGE");
  }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESULT_OBJECT_BYTES) throw fail("RESULT_STORAGE_TOO_LARGE");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw fail("RESULT_STORAGE_INVALID_RESULT");
    return result;
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error?.message?.startsWith("RESULT_STORAGE_TOO_LARGE:")) throw fail("RESULT_STORAGE_TOO_LARGE");
    throw fail("RESULT_STORAGE_INVALID_RESULT");
  } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}

export async function fetchResultObject(key, config, fetchImpl = globalThis.fetch, signal) {
  validateRequest(key, config);
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timer, rejectAbort;
  const abortPromise = new Promise((_, reject) => { rejectAbort = () => reject(fail("RESULT_STORAGE_READ_FAILED")); });
  controller.signal.addEventListener("abort", rejectAbort, { once: true });
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw fail("RESULT_STORAGE_READ_FAILED");
    timer = setTimeout(abort, READ_TIMEOUT_MS);
    const operation = (async () => {
      const request = await signResultObjectGet(key, config);
      controller.signal.throwIfAborted();
      const response = await fetchImpl(request.url, {
        method: "GET", redirect: "manual", credentials: "omit", signal: controller.signal, headers: request.headers,
      });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw fail("RESULT_STORAGE_READ_FAILED"); }
      return boundedObject(response, controller.signal);
    })();
    return await Promise.race([operation, abortPromise]);
  } catch (error) {
    if (error?.message?.startsWith("RESULT_STORAGE_TOO_LARGE:")) throw fail("RESULT_STORAGE_TOO_LARGE");
    throw fail("RESULT_STORAGE_READ_FAILED");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectAbort);
  }
}
