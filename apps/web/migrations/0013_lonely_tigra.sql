CREATE TABLE `privileged_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`identityId` text NOT NULL,
	`lifecycleGeneration` integer NOT NULL,
	`family` text NOT NULL,
	`type` text NOT NULL,
	`contractVersion` integer NOT NULL,
	`repository` text,
	`allowedRefs` text,
	`maxRequests` integer,
	`consumedRequests` integer DEFAULT 0 NOT NULL,
	`openedAt` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`closedAt` integer,
	`closeReason` text,
	`correlationId` text NOT NULL,
	`openSlot` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE INDEX `privileged_operations_identityId_idx` ON `privileged_operations` (`identityId`);--> statement-breakpoint
CREATE UNIQUE INDEX `privileged_operations_open_family_uidx` ON `privileged_operations` (`identityId`,`family`,`openSlot`);--> statement-breakpoint
CREATE TABLE `project_seeds` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`sourceCommit` text,
	`archiveId` text,
	`formatVersion` integer NOT NULL,
	`compatibilityKey` text NOT NULL,
	`buildState` text NOT NULL,
	`failureReasonCode` text,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_seeds_projectId_uidx` ON `project_seeds` (`projectId`);--> statement-breakpoint
CREATE TABLE `sandbox_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`sandboxId` text NOT NULL,
	`containerId` text NOT NULL,
	`userId` text NOT NULL,
	`projectId` text NOT NULL,
	`workspaceSessionId` text,
	`lifecycleGeneration` integer DEFAULT 1 NOT NULL,
	`state` text NOT NULL,
	`retiredAt` integer,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_identities_sandboxId_uidx` ON `sandbox_identities` (`sandboxId`);--> statement-breakpoint
CREATE INDEX `sandbox_identities_kind_projectId_idx` ON `sandbox_identities` (`kind`,`projectId`);