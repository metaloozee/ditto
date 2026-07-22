ALTER TABLE `projects` ADD `previewLockToken` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `previewLockExpiresAt` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `deletingAt` integer;--> statement-breakpoint
ALTER TABLE `workspace_sessions` ADD `previewPort` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_sessions_project_preview_port_uidx` ON `workspace_sessions` (`projectId`,`previewPort`);