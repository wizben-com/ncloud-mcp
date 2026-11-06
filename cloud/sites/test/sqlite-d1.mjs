// Real local SQLite behind the narrow D1 API used by this adapter; not a live D1 emulator.
import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import { SQL } from "../worker/index.js";

const directory = new URL("../drizzle/", import.meta.url);
export const migrations = await Promise.all((await readdir(directory)).filter((p) => p.endsWith(".sql"))
  .sort().map((p) => readFile(new URL(p, directory), "utf8")));

export class SqliteD1 {
  constructor({ filename = ":memory:", migrate = true } = {}) {
    this.sqlite = new DatabaseSync(filename);
    if (migrate) for (const sql of migrations) this.sqlite.exec(sql);
  }
  withSession(constraint) {
    if (constraint !== "first-primary") throw new Error("Unexpected session constraint");
    return this;
  }
  prepare(sql) {
    return { bind: (...values) => ({
      run: async () => {
        this.beforeRun?.(sql, values);
        const result = this.sqlite.prepare(sql).run(...values);
        this.afterRun?.(sql, values);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      first: async () => {
        this.beforeRead?.(sql, values);
        return this.sqlite.prepare(sql).get(...values) ?? null;
      },
    }) };
  }
  close() { this.sqlite.close(); }
}

export async function seedAccepted(bindings, owner = "synthetic-owner") {
  const scope = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(bindings.NCLOUD_SPEECH_INVOKE_URL))), (b) => b.toString(16).padStart(2, "0")).join("");
  const id = "job_" + crypto.randomUUID();
  await bindings.DB.prepare(SQL.claim).bind(id, owner, crypto.randomUUID(), scope, "0".repeat(64), 0).run();
  await bindings.DB.prepare(SQL.accepted).bind("synthetic-token", "SUCCEEDED", id, owner).run();
  return id;
}
