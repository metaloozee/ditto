import {
	type ArchiveBackupStore,
	createArchive,
} from "../../web/src/lib/sandbox-archive.ts";
import { getProjectSandbox } from "../../web/src/lib/sandbox-bootstrap.ts";
import { recordMutation } from "../../web/src/lib/workspace-recovery.ts";
import {
	type DrainWorkspaceRuntimeOptions,
	drainWorkspaceRuntimeQueue,
	type WorkspaceWorkExecutor,
} from "../../web/src/lib/workspace-runtime-capacity.ts";
import {
	containerIdForSandbox,
	type DecryptProjectValues,
	type WorkspaceRuntimePolicyDeps,
	withWorkspaceRuntimePolicyLease,
} from "../../web/src/lib/workspace-runtime-policy.ts";

type ProductSecretBinding =
	| "OPENCODE_API_KEY"
	| "BETTER_AUTH_SECRET"
	| "GITHUB_APP_PRIVATE_KEY"
	| "GITHUB_APP_ID"
	| "GITHUB_APP_CLIENT_ID"
	| "GITHUB_CLIENT_SECRET";

type AssertNever<T extends never> = T;
type AssertTrue<T extends true> = T;

type DrainKeys = keyof DrainWorkspaceRuntimeOptions;
type ExecutorKeys = keyof Parameters<WorkspaceWorkExecutor>[0];
type ArchiveKeys = keyof ArchiveBackupStore;
type DecryptParams = Parameters<DecryptProjectValues>;
type PolicyDepKeys = keyof WorkspaceRuntimePolicyDeps<unknown>;

export type DrainHasNoProductSecrets = AssertNever<
	Extract<DrainKeys, ProductSecretBinding>
>;
export type ExecutorHasNoProductSecrets = AssertNever<
	Extract<ExecutorKeys, ProductSecretBinding | "env">
>;
export type ArchiveHasNoProductSecrets = AssertNever<
	Extract<ArchiveKeys, ProductSecretBinding>
>;
export type DecryptHasNoSecretKey = AssertTrue<
	DecryptParams["length"] extends 1 ? true : never
>;
export type PolicyDepsHaveNoEnv = AssertNever<
	Extract<PolicyDepKeys, "env" | ProductSecretBinding>
>;

void containerIdForSandbox;
void withWorkspaceRuntimePolicyLease;
void drainWorkspaceRuntimeQueue;
void getProjectSandbox;
void createArchive;
void recordMutation;
