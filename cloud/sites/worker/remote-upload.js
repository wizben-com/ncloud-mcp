/** Portable Fetch/FormData helper; no platform identity, filesystem, or credentials.
 * Caller MUST validate the source against an operator-controlled exact HTTPS allowlist.
 * Source URLs can contain secrets: never log or return the request/response/error.
 */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
export async function fetchMediaUpload(spec, fetchImpl, signal) {
  const response = await fetchImpl(spec.media_url, {
    method: "GET", redirect: "manual", credentials: "omit", signal, headers: { Accept: "audio/*,video/*,application/octet-stream" },
  });
  const length = response.headers.get("content-length");
  const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (response.status !== 200 || !response.body || /^(?:text\/|application\/(?:json|xml|xhtml\+xml))/.test(type) ||
      (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_MEDIA_BYTES))) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Media fetch rejected.");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MEDIA_BYTES) throw new Error("Media too large.");
      chunks.push(value);
    }
    if (!size) throw new Error("Empty media.");
  } catch {
    await reader.cancel().catch(() => {});
    throw new Error("Media fetch failed.");
  } finally { reader.releaseLock(); }
  const blob = new Blob(chunks, { type: "application/octet-stream" });
  if (/\.ogg$/i.test(spec.filename) && new TextDecoder().decode(await blob.slice(0, 4).arrayBuffer()) !== "OggS") {
    throw new Error("Media signature mismatch.");
  }
  signal?.throwIfAborted();
  const form = new FormData();
  form.append("media", blob, spec.filename);
  form.append("params", JSON.stringify(spec.params));
  return form;
}
