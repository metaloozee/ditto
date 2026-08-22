CREATE TABLE `workspace_capacity_leases` (
	`id` text PRIMARY KEY NOT NULL,
	`sessionId` text NOT NULL,
	`userId` text NOT NULL,
	`identityId` text,
	`leaseToken` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_capacity_leases_sessionId_uidx` ON `workspace_capacity_leases` (`sessionId`);--> statement-breakpoint
CREATE INDEX `workspace_capacity_leases_userId_expiresAt_idx` ON `workspace_capacity_leases` (`userId`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `workspace_capacity_leases_expiresAt_idx` ON `workspace_capacity_leases` (`expiresAt`);--> statement-breakpoint
CREATE TABLE `workspace_runtime_work` (
	`id` text PRIMARY KEY NOT NULL,
	`fifoSeq` integer NOT NULL,
	`identityId` text,
	`sessionId` text,
	`projectId` text NOT NULL,
	`userId` text NOT NULL,
	`intent` text NOT NULL,
	`payload` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`leaseToken` text,
	`leaseExpiresAt` integer,
	`retryCount` integer DEFAULT 0 NOT NULL,
	`reasonCode` text,
	`queueExpiresAt` integer NOT NULL,
	`userMessageId` text,
	`assistantMessageId` text,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_runtime_work_fifoSeq_uidx` ON `workspace_runtime_work` (`fifoSeq`);--> statement-breakpoint
CREATE INDEX `workspace_runtime_work_status_fifoSeq_idx` ON `workspace_runtime_work` (`status`,`fifoSeq`);--> statement-breakpoint
CREATE INDEX `workspace_runtime_work_sessionId_idx` ON `workspace_runtime_work` (`sessionId`);--> statement-breakpoint
CREATE INDEX `workspace_runtime_work_userId_idx` ON `workspace_runtime_work` (`userId`);--> statement-breakpoint
CREATE INDEX `workspace_runtime_work_projectId_idx` ON `workspace_runtime_work` (`projectId`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_runtime_work_assistantMessageId_uidx` ON `workspace_runtime_work` (`assistantMessageId`);--> statement-breakpoint
ALTER TABLE `workspace_sessions` ADD `previewStartedAt` integer;