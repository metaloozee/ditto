CREATE TABLE `ai_provider_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`providerId` text NOT NULL,
	`authType` text NOT NULL,
	`encryptedCredential` text NOT NULL,
	`modelCatalog` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`lastErrorCode` text,
	`version` integer DEFAULT 1 NOT NULL,
	`leaseId` text,
	`leaseExpiresAt` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_provider_credentials_user_provider_uidx` ON `ai_provider_credentials` (`userId`,`providerId`);--> statement-breakpoint
CREATE INDEX `ai_provider_credentials_userId_idx` ON `ai_provider_credentials` (`userId`);--> statement-breakpoint
CREATE TABLE `provider_auth_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`providerId` text NOT NULL,
	`authType` text NOT NULL,
	`authSandboxId` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expiresAt` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `provider_auth_attempts_userId_idx` ON `provider_auth_attempts` (`userId`);