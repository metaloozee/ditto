CREATE TABLE `personal_workspace` (
	`user_id` text PRIMARY KEY,
	`workspace_id` text NOT NULL UNIQUE,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_personal_workspace_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
