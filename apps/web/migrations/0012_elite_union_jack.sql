CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspaceSessionId` text NOT NULL,
	`projectId` text NOT NULL,
	`userId` text NOT NULL,
	`sequence` integer NOT NULL,
	`predecessorRunId` text,
	`status` text DEFAULT 'accepted' NOT NULL,
	`currentExecutionEpoch` integer,
	`stopRequestId` text,
	`stopRequestedAt` integer,
	`outcomeCode` text,
	`acceptedAt` integer DEFAULT (unixepoch()) NOT NULL,
	`startedAt` integer,
	`finalizingAt` integer,
	`finishedAt` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspaceSessionId`) REFERENCES `workspace_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`predecessorRunId`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_runs_sequence_positive_ck" CHECK("agent_runs"."sequence" > 0),
	CONSTRAINT "agent_runs_status_ck" CHECK("agent_runs"."status" IN ('accepted','running','stopping','finalizing','completed','failed','cancelled','interrupted')),
	CONSTRAINT "agent_runs_epoch_positive_ck" CHECK("agent_runs"."currentExecutionEpoch" IS NULL OR "agent_runs"."currentExecutionEpoch" > 0),
	CONSTRAINT "agent_runs_terminal_shape_ck" CHECK(("agent_runs"."status" IN ('completed','failed','cancelled','interrupted') AND "agent_runs"."finishedAt" IS NOT NULL) OR ("agent_runs"."status" NOT IN ('completed','failed','cancelled','interrupted') AND "agent_runs"."finishedAt" IS NULL)),
	CONSTRAINT "agent_runs_outcome_shape_ck" CHECK(("agent_runs"."status" IN ('completed','failed','cancelled','interrupted') OR "agent_runs"."outcomeCode" IS NULL) AND ("agent_runs"."outcomeCode" IS NULL OR (length("agent_runs"."outcomeCode") <= 128 AND length("agent_runs"."outcomeCode") > 0 AND "agent_runs"."outcomeCode" NOT GLOB '*[^a-z0-9_:-]*')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runs_session_sequence_uidx` ON `agent_runs` (`workspaceSessionId`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runs_predecessor_uidx` ON `agent_runs` (`predecessorRunId`);--> statement-breakpoint
CREATE INDEX `agent_runs_project_session_status_idx` ON `agent_runs` (`projectId`,`workspaceSessionId`,`status`);--> statement-breakpoint
CREATE INDEX `agent_runs_userId_idx` ON `agent_runs` (`userId`);--> statement-breakpoint
CREATE TABLE `pi_agent_sessions` (
	`workspaceSessionId` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`userId` text NOT NULL,
	`currentRunId` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspaceSessionId`) REFERENCES `workspace_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`currentRunId`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `pi_agent_sessions_project_user_idx` ON `pi_agent_sessions` (`projectId`,`userId`);--> statement-breakpoint
CREATE TABLE `turns` (
	`id` text PRIMARY KEY NOT NULL,
	`runId` text NOT NULL,
	`workspaceSessionId` text NOT NULL,
	`projectId` text NOT NULL,
	`userId` text NOT NULL,
	`sequence` integer NOT NULL,
	`requestId` text NOT NULL,
	`userMessageId` text NOT NULL,
	`assistantMessageId` text NOT NULL,
	`modelSpecifier` text NOT NULL,
	`thinkingLevel` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`runId`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspaceSessionId`) REFERENCES `workspace_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userMessageId`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assistantMessageId`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "turns_sequence_positive_ck" CHECK("turns"."sequence" > 0),
	CONSTRAINT "turns_request_nonempty_ck" CHECK(length(trim("turns"."requestId")) > 0 AND length("turns"."requestId") <= 128),
	CONSTRAINT "turns_model_nonempty_ck" CHECK(length(trim("turns"."modelSpecifier")) > 0),
	CONSTRAINT "turns_thinking_level_ck" CHECK("turns"."thinkingLevel" IS NULL OR "turns"."thinkingLevel" IN ('off','minimal','low','medium','high','xhigh','max'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `turns_run_sequence_uidx` ON `turns` (`runId`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `turns_user_request_uidx` ON `turns` (`userId`,`requestId`);--> statement-breakpoint
CREATE UNIQUE INDEX `turns_user_message_uidx` ON `turns` (`userMessageId`);--> statement-breakpoint
CREATE UNIQUE INDEX `turns_assistant_message_uidx` ON `turns` (`assistantMessageId`);--> statement-breakpoint
CREATE INDEX `turns_project_session_run_idx` ON `turns` (`projectId`,`workspaceSessionId`,`runId`);
