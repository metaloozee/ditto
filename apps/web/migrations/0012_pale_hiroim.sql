CREATE TABLE `archives` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerKind` text NOT NULL,
	`ownerId` text NOT NULL,
	`objectKey` text NOT NULL,
	`formatVersion` integer NOT NULL,
	`compatibilityKey` text NOT NULL,
	`byteCount` integer DEFAULT 0 NOT NULL,
	`digest` text NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`cleanupRetryAt` integer,
	`cleanupAttempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE INDEX `archives_ownerKind_ownerId_idx` ON `archives` (`ownerKind`,`ownerId`);--> statement-breakpoint
CREATE INDEX `archives_status_cleanupRetryAt_idx` ON `archives` (`status`,`cleanupRetryAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `archives_objectKey_uidx` ON `archives` (`objectKey`);