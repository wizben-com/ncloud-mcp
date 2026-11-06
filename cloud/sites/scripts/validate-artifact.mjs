import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerPath = resolve(projectRoot, "dist/server/index.js");
const manifestPath = resolve(projectRoot, "dist/.openai/hosting.json");

const [source, manifest] = await Promise.all([
  readFile(workerPath, "utf8"),
  readFile(manifestPath, "utf8"),
]);
assert.equal(JSON.parse(manifest).d1, "DB", "D1 logical binding is required");
assert.equal(JSON.parse(manifest).r2, null);
const migrationSource = resolve(projectRoot, "drizzle");
const migrationBuild = resolve(projectRoot, "dist/.openai/drizzle");
async function compareTree(sourceDirectory, builtDirectory) {
  const sourceEntries = (await readdir(sourceDirectory)).sort();
  assert.deepEqual((await readdir(builtDirectory)).sort(), sourceEntries);
  for (const name of sourceEntries) {
    if (name === "meta") await compareTree(resolve(sourceDirectory, name), resolve(builtDirectory, name));
    else assert.deepEqual(await readFile(resolve(sourceDirectory, name)), await readFile(resolve(builtDirectory, name)));
  }
}
await compareTree(migrationSource, migrationBuild);
const journal = JSON.parse(await readFile(resolve(migrationBuild, "meta/_journal.json"), "utf8"));
assert.equal(journal.dialect, "sqlite");
assert.ok(journal.entries.length > 0);
for (const entry of journal.entries) {
  const sql = await readFile(resolve(migrationBuild, entry.tag + ".sql"), "utf8");
  assert.ok(Buffer.byteLength(sql) <= 16384, "Migrations must stay bounded");
  assert.ok(!/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql), "No data backfill/seed in migrations");
  JSON.parse(await readFile(resolve(migrationBuild, "meta", String(entry.idx).padStart(4, "0") + "_snapshot.json"), "utf8"));
}

// A data URL forces ESM parsing even though the generated output has no package.json.
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const workerModule = await import(moduleUrl);
assert.equal(
  typeof workerModule.default?.fetch,
  "function",
  `${pathToFileURL(workerPath)} must export default.fetch`,
);
for (const sql of Object.values(workerModule.SQL)) {
  assert.ok(!/\b(?:CREATE|ALTER|DROP|DELETE)\b/i.test(sql), "No runtime DDL/tombstone deletion");
}

console.log("Artifact is valid ESM; D1 migration, snapshot and journal match source; runtime SQL has no DDL/deletion");
