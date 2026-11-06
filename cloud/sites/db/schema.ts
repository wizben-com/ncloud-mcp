// Development-only schema generation; Worker requests use fixed native D1 statements.
import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const speechJobs = sqliteTable("ncloud_speech_jobs", {
  jobId: text("job_id").primaryKey().notNull(),
  ownerId: text("owner_id").notNull(),
  requestId: text("request_id").notNull(),
  providerScope: text("provider_scope").notNull(),
  payloadHash: text("payload_hash").notNull(),
  submissionState: text("submission_state").notNull(),
  upstreamToken: text("upstream_token"),
  providerState: text("provider_state"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("speech_owner_request_unique").on(table.ownerId, table.requestId),
  check("speech_job_id_length", sql`length(${table.jobId}) = 40`),
  check("speech_owner_length", sql`length(${table.ownerId}) BETWEEN 1 AND 256`),
  check("speech_request_id", sql`length(${table.requestId}) BETWEEN 8 AND 128 AND ${table.requestId} NOT GLOB '*[^A-Za-z0-9_-]*'`),
  check("speech_scope_hash", sql`length(${table.providerScope}) = 64 AND ${table.providerScope} NOT GLOB '*[^0-9a-f]*'`),
  check("speech_payload_hash", sql`length(${table.payloadHash}) = 64 AND ${table.payloadHash} NOT GLOB '*[^0-9a-f]*'`),
  check("speech_submission_state", sql`${table.submissionState} IN ('SUBMITTING', 'ACCEPTED', 'UNKNOWN')`),
  check("speech_token", sql`${table.upstreamToken} IS NULL OR (length(${table.upstreamToken}) BETWEEN 1 AND 256 AND ${table.upstreamToken} NOT GLOB '*[^A-Za-z0-9_-]*')`),
  check("speech_accepted_tracking", sql`${table.submissionState} != 'ACCEPTED' OR ${table.upstreamToken} IS NOT NULL`),
  check("speech_provider_state", sql`${table.providerState} IS NULL OR ${table.providerState} IN ('SUCCEEDED', 'WAITING', 'PROCESSING', 'FAILED', 'COMPLETED', 'TIMEOUT')`),
]);
