CREATE TABLE `run_artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`runId` text NOT NULL,
	`projectId` text NOT NULL,
	`kind` text NOT NULL,
	`r2Key` text NOT NULL,
	`contentType` text,
	`byteLength` integer,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`runId`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_artifacts_runId_idx` ON `run_artifacts` (`runId`);--> statement-breakpoint
CREATE INDEX `run_artifacts_projectId_idx` ON `run_artifacts` (`projectId`);--> statement-breakpoint
CREATE INDEX `run_artifacts_kind_idx` ON `run_artifacts` (`kind`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`runId` text,
	`r2Key` text NOT NULL,
	`baseCommitSha` text,
	`digest` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	`completedAt` integer,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`runId`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `snapshots_projectId_idx` ON `snapshots` (`projectId`);--> statement-breakpoint
CREATE INDEX `snapshots_runId_idx` ON `snapshots` (`runId`);--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `flueAgentName` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `flueAgentInstanceId` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `flueSubmissionId` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `flueStreamOffset` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `snapshotId` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `errorCode` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `lockStatus` text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `lockHolderRunId` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `lockFencingToken` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `lockUpdatedAt` integer;