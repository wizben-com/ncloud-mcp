CREATE TABLE `ncloud_speech_jobs` (
	`job_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`request_id` text NOT NULL,
	`provider_scope` text NOT NULL,
	`payload_hash` text NOT NULL,
	`submission_state` text NOT NULL,
	`upstream_token` text,
	`provider_state` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "speech_job_id_length" CHECK(length("ncloud_speech_jobs"."job_id") = 40),
	CONSTRAINT "speech_owner_length" CHECK(length("ncloud_speech_jobs"."owner_id") BETWEEN 1 AND 256),
	CONSTRAINT "speech_request_id" CHECK(length("ncloud_speech_jobs"."request_id") BETWEEN 8 AND 128 AND "ncloud_speech_jobs"."request_id" NOT GLOB '*[^A-Za-z0-9_-]*'),
	CONSTRAINT "speech_scope_hash" CHECK(length("ncloud_speech_jobs"."provider_scope") = 64 AND "ncloud_speech_jobs"."provider_scope" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "speech_payload_hash" CHECK(length("ncloud_speech_jobs"."payload_hash") = 64 AND "ncloud_speech_jobs"."payload_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "speech_submission_state" CHECK("ncloud_speech_jobs"."submission_state" IN ('SUBMITTING', 'ACCEPTED', 'UNKNOWN')),
	CONSTRAINT "speech_token" CHECK("ncloud_speech_jobs"."upstream_token" IS NULL OR (length("ncloud_speech_jobs"."upstream_token") BETWEEN 1 AND 256 AND "ncloud_speech_jobs"."upstream_token" NOT GLOB '*[^A-Za-z0-9_-]*')),
	CONSTRAINT "speech_accepted_tracking" CHECK("ncloud_speech_jobs"."submission_state" != 'ACCEPTED' OR "ncloud_speech_jobs"."upstream_token" IS NOT NULL),
	CONSTRAINT "speech_provider_state" CHECK("ncloud_speech_jobs"."provider_state" IS NULL OR "ncloud_speech_jobs"."provider_state" IN ('SUCCEEDED', 'WAITING', 'PROCESSING', 'FAILED', 'COMPLETED', 'TIMEOUT'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `speech_owner_request_unique` ON `ncloud_speech_jobs` (`owner_id`,`request_id`);