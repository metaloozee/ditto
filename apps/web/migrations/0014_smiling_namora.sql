ALTER TABLE `workspace_sessions` ADD `sandboxIdentityId` text;--> statement-breakpoint
ALTER TABLE `workspace_sessions` ADD `runtimeLeaseId` text;--> statement-breakpoint
ALTER TABLE `workspace_sessions` ADD `runtimeLeaseExpiresAt` integer;--> statement-breakpoint
ALTER TABLE `workspace_sessions` ADD `runtimeFailureReasonCode` text;--> statement-breakpoint
CREATE INDEX `workspace_sessions_sandboxIdentityId_idx` ON `workspace_sessions` (`sandboxIdentityId`);