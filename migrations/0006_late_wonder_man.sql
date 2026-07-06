CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`sessionId` text NOT NULL,
	`projectId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`model` text,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`sessionId`) REFERENCES `workspace_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_sessionId_idx` ON `messages` (`sessionId`);--> statement-breakpoint
CREATE INDEX `messages_projectId_idx` ON `messages` (`projectId`);--> statement-breakpoint
DROP TABLE `agent_run_events`;--> statement-breakpoint
DROP TABLE `agent_runs`;--> statement-breakpoint
DROP TABLE `run_artifacts`;--> statement-breakpoint
DROP TABLE `snapshots`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `activeAgentRunId`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `activeAgentRunStartedAt`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `lockStatus`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `lockHolderRunId`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `lockFencingToken`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `lockUpdatedAt`;