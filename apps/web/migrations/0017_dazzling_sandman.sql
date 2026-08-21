CREATE TABLE `workspace_session_recoveries` (
	`sessionId` text PRIMARY KEY NOT NULL,
	`mutationGeneration` integer DEFAULT 0 NOT NULL,
	`durableGeneration` integer DEFAULT 0 NOT NULL,
	`pendingGeneration` integer,
	`pendingSince` integer,
	`currentArchiveId` text,
	`previousArchiveId` text,
	`state` text DEFAULT 'healthy' NOT NULL,
	`reasonCode` text,
	`retryAttempts` integer DEFAULT 0 NOT NULL,
	`retryAt` integer,
	`checkpointLeaseId` text,
	`checkpointLeaseExpiresAt` integer,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`sessionId`) REFERENCES `workspace_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
