CREATE TABLE `__new_session_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`targetKind` text NOT NULL,
	`targetId` text NOT NULL,
	`projectId` text NOT NULL,
	`sessionId` text,
	`kind` text NOT NULL,
	`commandSeq` integer,
	`targetRunId` text,
	`targetCommandId` text,
	`payloadVersion` integer NOT NULL,
	`userMessageId` text,
	`assistantMessageId` text,
	`payloadDigest` text NOT NULL,
	`acceptedAt` integer NOT NULL,
	`deadlineAt` integer NOT NULL,
	`admissionVersion` integer DEFAULT 1 NOT NULL,
	`executionProjectionVersion` integer DEFAULT 0 NOT NULL,
	`reasonCode` text,
	CONSTRAINT "session_commands_kind_enum" CHECK("__new_session_commands"."kind" IN ('prompt', 'follow_up', 'stop', 'cancel', 'project_delete', 'restore_checkpoint_acknowledging_loss')),
	CONSTRAINT "session_commands_target_kind_enum" CHECK("__new_session_commands"."targetKind" IN ('project', 'workspace_session')),
	CONSTRAINT "session_commands_target_shape" CHECK(("__new_session_commands"."kind" = 'project_delete' AND "__new_session_commands"."targetKind" = 'project' AND "__new_session_commands"."sessionId" IS NULL AND "__new_session_commands"."commandSeq" IS NULL) OR ("__new_session_commands"."kind" != 'project_delete' AND "__new_session_commands"."targetKind" = 'workspace_session' AND "__new_session_commands"."sessionId" IS NOT NULL AND "__new_session_commands"."commandSeq" IS NOT NULL AND typeof("__new_session_commands"."commandSeq") = 'integer' AND "__new_session_commands"."commandSeq" > 0)),
	CONSTRAINT "session_commands_message_shape" CHECK(("__new_session_commands"."kind" IN ('prompt', 'follow_up') AND "__new_session_commands"."userMessageId" IS NOT NULL AND "__new_session_commands"."assistantMessageId" IS NOT NULL) OR ("__new_session_commands"."kind" NOT IN ('prompt', 'follow_up') AND "__new_session_commands"."userMessageId" IS NULL AND "__new_session_commands"."assistantMessageId" IS NULL)),
	CONSTRAINT "session_commands_run_shape" CHECK(("__new_session_commands"."kind" IN ('follow_up', 'stop') AND "__new_session_commands"."targetRunId" IS NOT NULL AND "__new_session_commands"."targetCommandId" IS NULL) OR ("__new_session_commands"."kind" = 'cancel' AND "__new_session_commands"."targetRunId" IS NULL AND "__new_session_commands"."targetCommandId" IS NOT NULL) OR ("__new_session_commands"."kind" NOT IN ('follow_up', 'stop', 'cancel') AND "__new_session_commands"."targetRunId" IS NULL AND "__new_session_commands"."targetCommandId" IS NULL)),
	CONSTRAINT "session_commands_versions" CHECK(typeof("__new_session_commands"."payloadVersion") = 'integer' AND "__new_session_commands"."payloadVersion" > 0 AND typeof("__new_session_commands"."admissionVersion") = 'integer' AND "__new_session_commands"."admissionVersion" > 0 AND typeof("__new_session_commands"."executionProjectionVersion") = 'integer' AND "__new_session_commands"."executionProjectionVersion" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_session_commands`(`id`, `userId`, `targetKind`, `targetId`, `projectId`, `sessionId`, `kind`, `commandSeq`, `targetRunId`, `targetCommandId`, `payloadVersion`, `userMessageId`, `assistantMessageId`, `payloadDigest`, `acceptedAt`, `deadlineAt`, `admissionVersion`, `executionProjectionVersion`, `reasonCode`) SELECT `id`, `userId`, `targetKind`, `targetId`, `projectId`, `sessionId`, `kind`, `commandSeq`, `targetRunId`, `targetCommandId`, `payloadVersion`, `userMessageId`, `assistantMessageId`, `payloadDigest`, `acceptedAt`, `deadlineAt`, `admissionVersion`, `executionProjectionVersion`, `reasonCode` FROM `session_commands`;
--> statement-breakpoint
DROP TABLE `session_commands`;
--> statement-breakpoint
ALTER TABLE `__new_session_commands` RENAME TO `session_commands`;
--> statement-breakpoint
CREATE UNIQUE INDEX `session_commands_session_seq_uidx` ON `session_commands` (`sessionId`,`commandSeq`);
--> statement-breakpoint
CREATE INDEX `session_commands_user_target_idx` ON `session_commands` (`userId`,`targetKind`,`targetId`);
--> statement-breakpoint
CREATE TABLE candidate_restore_barriers (
 restoreCommandId TEXT PRIMARY KEY NOT NULL,
 sessionId TEXT NOT NULL,
 ownerVersion INTEGER NOT NULL CHECK(ownerVersion=1),
 pairId TEXT NOT NULL,
 expectedMutationGeneration INTEGER NOT NULL CHECK(expectedMutationGeneration>0),
 cutoffSeq INTEGER NOT NULL CHECK(cutoffSeq>=0),
 state TEXT NOT NULL CHECK(state IN ('closed','complete','refused')),
 restoredPairId TEXT,
 fallback INTEGER CHECK(fallback IN (0,1)),
 conversationGeneration INTEGER,
 openedAt INTEGER NOT NULL,
 completedAt INTEGER,
 CHECK((state='closed' AND restoredPairId IS NULL AND fallback IS NULL AND conversationGeneration IS NULL AND completedAt IS NULL) OR (state='complete' AND restoredPairId IS NOT NULL AND fallback IS NOT NULL AND conversationGeneration>1 AND completedAt IS NOT NULL) OR (state='refused' AND restoredPairId IS NULL AND fallback IS NULL AND conversationGeneration IS NULL AND completedAt IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX candidate_restore_barriers_closed_uidx ON candidate_restore_barriers(sessionId) WHERE state='closed';
--> statement-breakpoint
CREATE TRIGGER candidate_restore_barriers_final BEFORE UPDATE ON candidate_restore_barriers WHEN OLD.state!='closed' BEGIN SELECT RAISE(ABORT,'restore barrier is final'); END;
