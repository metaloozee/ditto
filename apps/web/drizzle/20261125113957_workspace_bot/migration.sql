CREATE TABLE `workspace_bot` (
	`workspace_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`name` text NOT NULL,
	CONSTRAINT `workspace_bot_pk` PRIMARY KEY(`workspace_id`, `bot_id`)
);
