-- Destructive pre-launch reset. Never use this migration as the production deletion path.
UPDATE `privileged_operations`
SET `closedAt` = COALESCE(`closedAt`, unixepoch()),
	`closeReason` = COALESCE(`closeReason`, 'prelaunch_reset'),
	`openSlot` = `id`,
	`updated_at` = unixepoch()
WHERE `closedAt` IS NULL;--> statement-breakpoint
UPDATE `sandbox_identities`
SET `state` = 'destroyed',
	`retiredAt` = COALESCE(`retiredAt`, unixepoch()),
	`updated_at` = unixepoch()
WHERE `retiredAt` IS NULL;--> statement-breakpoint
UPDATE `archives`
SET `status` = 'abandoned',
	`cleanupRetryAt` = COALESCE(`cleanupRetryAt`, unixepoch()),
	`updated_at` = unixepoch()
WHERE `status` IN ('uploading', 'ready');--> statement-breakpoint
DELETE FROM `provider_auth_attempts`;--> statement-breakpoint
DELETE FROM `ai_provider_credentials`;--> statement-breakpoint
DELETE FROM `workspace_capacity_leases`;--> statement-breakpoint
DELETE FROM `workspace_runtime_work`;--> statement-breakpoint
DELETE FROM `messages`;--> statement-breakpoint
DELETE FROM `workspace_session_recoveries`;--> statement-breakpoint
DELETE FROM `workspace_sessions`;--> statement-breakpoint
DELETE FROM `project_seeds`;--> statement-breakpoint
DELETE FROM `projects`;--> statement-breakpoint
DROP TABLE `ai_provider_credentials`;--> statement-breakpoint
DROP TABLE `provider_auth_attempts`;--> statement-breakpoint
DROP INDEX `workspace_sessions_project_preview_port_uidx`;--> statement-breakpoint
ALTER TABLE `workspace_sessions` DROP COLUMN `workspacePath`;--> statement-breakpoint
ALTER TABLE `workspace_sessions` DROP COLUMN `memoryPath`;--> statement-breakpoint
ALTER TABLE `workspace_sessions` DROP COLUMN `previewPort`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `sandboxId`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `sandboxBackup`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `sandboxBackupCreatedAt`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `sandboxBackupRequestedGeneration`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `sandboxBackupStoredGeneration`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `previewLockToken`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `previewLockExpiresAt`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `deletingAt`;