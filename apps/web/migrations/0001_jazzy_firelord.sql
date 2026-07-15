CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`userId` text NOT NULL,
	`githubRepo` text,
	`githubInstallationId` integer,
	`sandboxId` text,
	`status` text DEFAULT 'provisioning' NOT NULL,
	`envVars` text,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `projects_userId_idx` ON `projects` (`userId`);