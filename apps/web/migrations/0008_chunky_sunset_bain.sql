ALTER TABLE `projects` ADD `sandboxBackupRequestedGeneration` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `sandboxBackupStoredGeneration` integer DEFAULT 0 NOT NULL;