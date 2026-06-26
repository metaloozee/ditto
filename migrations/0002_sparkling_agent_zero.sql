CREATE TABLE `agent_run_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`runId` text,
	`projectId` text NOT NULL,
	`sessionId` text,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_run_events_runId_idx` ON `agent_run_events` (`runId`);--> statement-breakpoint
CREATE INDEX `agent_run_events_projectId_idx` ON `agent_run_events` (`projectId`);--> statement-breakpoint
CREATE INDEX `agent_run_events_sessionId_idx` ON `agent_run_events` (`sessionId`);--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`sessionId` text NOT NULL,
	`userId` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`isMutating` integer DEFAULT true NOT NULL,
	`userMessage` text NOT NULL,
	`question` text,
	`recommendedAnswer` text,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	`finishedAt` integer,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sessionId`) REFERENCES `workspace_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_runs_projectId_idx` ON `agent_runs` (`projectId`);--> statement-breakpoint
CREATE INDEX `agent_runs_sessionId_idx` ON `agent_runs` (`sessionId`);--> statement-breakpoint
CREATE INDEX `agent_runs_userId_idx` ON `agent_runs` (`userId`);--> statement-breakpoint
CREATE INDEX `agent_runs_status_idx` ON `agent_runs` (`status`);--> statement-breakpoint
CREATE TABLE `workspace_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`userId` text NOT NULL,
	`title` text,
	`branchName` text,
	`baseCommitSha` text,
	`workspacePath` text DEFAULT '/workspace' NOT NULL,
	`memoryPath` text DEFAULT '/workspace/.ditto/project-memory.md' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspace_sessions_projectId_idx` ON `workspace_sessions` (`projectId`);--> statement-breakpoint
CREATE INDEX `workspace_sessions_userId_idx` ON `workspace_sessions` (`userId`);--> statement-breakpoint
ALTER TABLE `projects` ADD `activeAgentRunId` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `activeAgentRunStartedAt` integer;