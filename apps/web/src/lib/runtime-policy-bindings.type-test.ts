import type { ForbiddenProductBinding } from "./runtime-policy-types";
import type { ArchiveBackupStore } from "./sandbox-archive";
import { createArchive } from "./sandbox-archive";
import type { ProjectSandboxBinding } from "./sandbox-bootstrap";
import { getProjectSandbox } from "./sandbox-bootstrap";
import { recordMutation } from "./workspace-recovery";
import type {
	DrainWorkspaceRuntimeOptions,
	WorkspaceWorkExecutor,
} from "./workspace-runtime-capacity";
import { drainWorkspaceRuntimeQueue } from "./workspace-runtime-capacity";
import type {
	DecryptProjectValues,
	WorkspaceRuntimePolicyDeps,
	WorkspaceSandboxNamespace,
} from "./workspace-runtime-policy";
import {
	containerIdForSandbox,
	withWorkspaceRuntimePolicyLease,
} from "./workspace-runtime-policy";

type AssertNever<T extends never> = T;
type AssertTrue<T extends true> = T;

type DrainKeys = keyof DrainWorkspaceRuntimeOptions;
type ExecutorKeys = keyof Parameters<WorkspaceWorkExecutor>[0];

export type DrainHasNoEnv = AssertNever<Extract<DrainKeys, "env">>;
export type ExecutorHasNoEnv = AssertNever<Extract<ExecutorKeys, "env">>;
export type DrainHasNoProductSecrets = AssertNever<
	Extract<DrainKeys, ForbiddenProductBinding>
>;
export type NamespaceHasNoProductSecrets = AssertNever<
	Extract<keyof WorkspaceSandboxNamespace, ForbiddenProductBinding>
>;
export type SandboxBindingHasNoProductSecrets = AssertNever<
	Extract<keyof ProjectSandboxBinding, ForbiddenProductBinding>
>;
export type ArchiveStoreHasNoProductSecrets = AssertNever<
	Extract<keyof ArchiveBackupStore, ForbiddenProductBinding>
>;
export type DecryptArityIsOne = AssertTrue<
	Parameters<DecryptProjectValues>["length"] extends 1 ? true : never
>;
export type PolicyDepsHaveNoEnv = AssertNever<
	Extract<keyof WorkspaceRuntimePolicyDeps<unknown>, "env">
>;

void containerIdForSandbox;
void withWorkspaceRuntimePolicyLease;
void drainWorkspaceRuntimeQueue;
void getProjectSandbox;
void createArchive;
void recordMutation;
