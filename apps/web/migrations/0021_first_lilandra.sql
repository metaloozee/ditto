CREATE TABLE `codex_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`generation` integer NOT NULL,
	`revoked` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`projection_version` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "codex_generation" CHECK("codex_connections"."generation" > 0),
	CONSTRAINT "codex_status" CHECK("codex_connections"."status" IN ('connected','renewing','reconnect_required','disconnected')),
	CONSTRAINT "codex_revoked" CHECK("codex_connections"."revoked" IN (0,1))
);
