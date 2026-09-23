CREATE TABLE `runtime_capacity_policy` (
	`id` integer PRIMARY KEY NOT NULL,
	`accountingMode` text DEFAULT 'legacy' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updatedAt` integer NOT NULL,
	CONSTRAINT "runtime_capacity_policy_singleton" CHECK("runtime_capacity_policy"."id" = 1),
	CONSTRAINT "runtime_capacity_policy_mode" CHECK("runtime_capacity_policy"."accountingMode" IN ('legacy', 'unified')),
	CONSTRAINT "runtime_capacity_policy_version" CHECK(typeof("runtime_capacity_policy"."version") = 'integer' AND "runtime_capacity_policy"."version" > 0)
);
--> statement-breakpoint
INSERT INTO `runtime_capacity_policy` (`id`, `accountingMode`, `version`, `updatedAt`)
VALUES (1, 'legacy', 1, unixepoch());
--> statement-breakpoint
CREATE TABLE `runtime_capacity_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`pool` text NOT NULL,
	`ownerKind` text NOT NULL,
	`ownerId` text NOT NULL,
	`userId` text NOT NULL,
	`sessionId` text,
	`identityId` text NOT NULL,
	`incarnationId` text,
	`reservationGroupId` text NOT NULL,
	`observedState` text NOT NULL,
	`expiresAt` integer,
	`runtimeOwnerVersion` integer NOT NULL,
	`accountingVersion` integer NOT NULL,
	`activeSlot` text DEFAULT 'active' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	CONSTRAINT "runtime_capacity_reservations_enums" CHECK("runtime_capacity_reservations"."pool" IN ('brain', 'execution') AND "runtime_capacity_reservations"."ownerKind" IN ('workspace_session', 'builder', 'preview') AND "runtime_capacity_reservations"."observedState" IN ('reserved', 'starting', 'running', 'terminating', 'released')),
	CONSTRAINT "runtime_capacity_reservations_versions" CHECK(typeof("runtime_capacity_reservations"."runtimeOwnerVersion") = 'integer' AND "runtime_capacity_reservations"."runtimeOwnerVersion" > 0 AND typeof("runtime_capacity_reservations"."accountingVersion") = 'integer' AND "runtime_capacity_reservations"."accountingVersion" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_capacity_reservations_identity_pool_active_uidx` ON `runtime_capacity_reservations` (`identityId`,`pool`,`activeSlot`);--> statement-breakpoint
CREATE TABLE `runtime_checkpoint_pairs` (
	`id` text PRIMARY KEY NOT NULL,
	`sessionId` text NOT NULL,
	`archiveId` text NOT NULL,
	`continuationObjectKey` text NOT NULL,
	`archiveDigest` text NOT NULL,
	`continuationDigest` text NOT NULL,
	`archiveByteCount` integer NOT NULL,
	`continuationByteCount` integer NOT NULL,
	`compatibilityKey` text NOT NULL,
	`brainIdentityId` text NOT NULL,
	`brainIncarnationId` text NOT NULL,
	`executorIdentityId` text NOT NULL,
	`executorIncarnationId` text NOT NULL,
	`mutationGeneration` integer NOT NULL,
	`executionPosition` integer NOT NULL,
	`outstandingEffectCount` integer NOT NULL,
	`outstandingEffectSummary` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runtime_checkpoint_pointers` (
	`sessionId` text PRIMARY KEY NOT NULL,
	`runtimeOwnerVersion` integer NOT NULL,
	`currentPairId` text,
	`previousPairId` text,
	`mutationGeneration` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runtime_cleanup_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`targetKind` text NOT NULL,
	`targetId` text NOT NULL,
	`state` text NOT NULL,
	`retryAt` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runtime_command_memberships` (
	`commandId` text PRIMARY KEY NOT NULL,
	`sessionId` text NOT NULL,
	`runId` text,
	`userMessageId` text,
	`assistantMessageId` text,
	`runEpoch` integer
);
--> statement-breakpoint
CREATE TABLE `runtime_deleted_target_fences` (
	`targetKind` text NOT NULL,
	`targetId` text NOT NULL,
	`lastOwnerVersion` integer NOT NULL,
	`deletedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_deleted_target_fences_target_uidx` ON `runtime_deleted_target_fences` (`targetKind`,`targetId`);--> statement-breakpoint
CREATE TABLE `runtime_migrations` (
	`id` text PRIMARY KEY NOT NULL,
	`sessionId` text NOT NULL,
	`expectedOwner` text NOT NULL,
	`expectedOwnerVersion` integer NOT NULL,
	`sourceArchiveId` text,
	`sourceIdentityId` text,
	`startupRoles` text,
	`startupPools` text,
	`expectedIdentityId` text,
	`startupDeadline` integer,
	`state` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runtime_projection_cursors` (
	`sessionId` text NOT NULL,
	`targetKind` text NOT NULL,
	`targetId` text NOT NULL,
	`runtimeOwnerVersion` integer NOT NULL,
	`coordinatorSeq` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_projection_cursors_target_uidx` ON `runtime_projection_cursors` (`sessionId`,`targetKind`,`targetId`);--> statement-breakpoint
CREATE TABLE `runtime_retired_identity_fences` (
	`identityId` text PRIMARY KEY NOT NULL,
	`lifecycleGeneration` integer NOT NULL,
	`retiredAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_command_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`targetKind` text NOT NULL,
	`targetId` text NOT NULL,
	`idempotencyKey` text NOT NULL,
	`commandKind` text NOT NULL,
	`canonicalPayloadHash` text NOT NULL,
	`commandId` text NOT NULL,
	`receiptId` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_command_keys_scope_uidx` ON `session_command_keys` (`userId`,`targetKind`,`targetId`,`idempotencyKey`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_command_keys_receipt_uidx` ON `session_command_keys` (`receiptId`);--> statement-breakpoint
CREATE TABLE `session_command_sequences` (
	`sessionId` text PRIMARY KEY NOT NULL,
	`nextSequence` integer DEFAULT 1 NOT NULL,
	`updatedAt` integer NOT NULL,
	CONSTRAINT "session_command_sequences_positive" CHECK("session_command_sequences"."nextSequence" > 0)
);
--> statement-breakpoint
CREATE TABLE `session_commands` (
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
	CONSTRAINT "session_commands_kind_enum" CHECK("session_commands"."kind" IN ('prompt', 'follow_up', 'stop', 'cancel', 'project_delete')),
	CONSTRAINT "session_commands_target_kind_enum" CHECK("session_commands"."targetKind" IN ('project', 'workspace_session')),
	CONSTRAINT "session_commands_target_shape" CHECK(("session_commands"."kind" = 'project_delete' AND "session_commands"."targetKind" = 'project' AND "session_commands"."sessionId" IS NULL AND "session_commands"."commandSeq" IS NULL) OR ("session_commands"."kind" != 'project_delete' AND "session_commands"."targetKind" = 'workspace_session' AND "session_commands"."sessionId" IS NOT NULL AND "session_commands"."commandSeq" IS NOT NULL AND typeof("session_commands"."commandSeq") = 'integer' AND "session_commands"."commandSeq" > 0)),
	CONSTRAINT "session_commands_message_shape" CHECK(("session_commands"."kind" IN ('prompt', 'follow_up') AND "session_commands"."userMessageId" IS NOT NULL AND "session_commands"."assistantMessageId" IS NOT NULL) OR ("session_commands"."kind" NOT IN ('prompt', 'follow_up') AND "session_commands"."userMessageId" IS NULL AND "session_commands"."assistantMessageId" IS NULL)),
	CONSTRAINT "session_commands_run_shape" CHECK(("session_commands"."kind" IN ('follow_up', 'stop') AND "session_commands"."targetRunId" IS NOT NULL AND "session_commands"."targetCommandId" IS NULL) OR ("session_commands"."kind" = 'cancel' AND "session_commands"."targetRunId" IS NULL AND "session_commands"."targetCommandId" IS NOT NULL) OR ("session_commands"."kind" NOT IN ('follow_up', 'stop', 'cancel') AND "session_commands"."targetRunId" IS NULL AND "session_commands"."targetCommandId" IS NULL)),
	CONSTRAINT "session_commands_versions" CHECK(typeof("session_commands"."payloadVersion") = 'integer' AND "session_commands"."payloadVersion" > 0 AND typeof("session_commands"."admissionVersion") = 'integer' AND "session_commands"."admissionVersion" > 0 AND typeof("session_commands"."executionProjectionVersion") = 'integer' AND "session_commands"."executionProjectionVersion" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_commands_session_seq_uidx` ON `session_commands` (`sessionId`,`commandSeq`);--> statement-breakpoint
CREATE INDEX `session_commands_user_target_idx` ON `session_commands` (`userId`,`targetKind`,`targetId`);--> statement-breakpoint
ALTER TABLE `privileged_operations` ADD `runtimeOwnerVersion` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `privileged_operations` ADD `runId` text;--> statement-breakpoint
ALTER TABLE `privileged_operations` ADD `runEpoch` integer;--> statement-breakpoint
ALTER TABLE `privileged_operations` ADD `incarnationId` text;--> statement-breakpoint
ALTER TABLE `privileged_operations` ADD `admissionReference` text;--> statement-breakpoint
ALTER TABLE `project_seeds` ADD `startupRoles` text;--> statement-breakpoint
ALTER TABLE `project_seeds` ADD `startupPools` text;--> statement-breakpoint
ALTER TABLE `project_seeds` ADD `expectedRuntimeOwnerVersion` integer;--> statement-breakpoint
ALTER TABLE `project_seeds` ADD `expectedIdentityId` text;--> statement-breakpoint
ALTER TABLE `project_seeds` ADD `startupDeadline` integer;--> statement-breakpoint
ALTER TABLE `sandbox_identities` ADD `controllerClass` text;--> statement-breakpoint
ALTER TABLE `sandbox_identities` ADD `controllerNamespace` text;--> statement-breakpoint
ALTER TABLE `sandbox_identities` ADD `incarnationId` text;--> statement-breakpoint
ALTER TABLE `sandbox_identities` ADD `incarnationStartedAt` integer;--> statement-breakpoint
ALTER TABLE `workspace_runtime_work` ADD `protocolVersion` integer;--> statement-breakpoint
ALTER TABLE `workspace_runtime_work` ADD `runtimeOwner` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_runtime_work` ADD `runtimeOwnerVersion` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_runtime_work` ADD `commandId` text;--> statement-breakpoint
ALTER TABLE `workspace_runtime_work` ADD `deliveryState` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_runtime_work` ADD `deliveryLeaseToken` text;--> statement-breakpoint
ALTER TABLE `workspace_runtime_work` ADD `deliveryLeaseExpiresAt` integer;--> statement-breakpoint
ALTER TABLE `workspace_runtime_work` ADD `deliveryAttempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_runtime_work` ADD `startupRoles` text;--> statement-breakpoint
ALTER TABLE `workspace_runtime_work` ADD `startupPools` text;--> statement-breakpoint
ALTER TABLE `workspace_runtime_work` ADD `expectedIdentityId` text;--> statement-breakpoint
ALTER TABLE `workspace_runtime_work` ADD `startupDeadline` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_runtime_work_commandId_uidx` ON `workspace_runtime_work` (`commandId`);--> statement-breakpoint
ALTER TABLE `workspace_sessions` ADD `runtimeOwner` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_sessions` ADD `runtimeOwnerVersion` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_sessions` ADD `brainIdentityId` text;--> statement-breakpoint
ALTER TABLE `workspace_sessions` ADD `runtimeProtocolVersion` integer;--> statement-breakpoint
ALTER TABLE `workspace_sessions` ADD `runtimeJournalVersion` integer;--> statement-breakpoint
ALTER TABLE `workspace_sessions` ADD `productProjectionVersion` integer DEFAULT 0 NOT NULL;
