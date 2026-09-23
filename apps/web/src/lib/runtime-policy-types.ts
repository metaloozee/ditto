/** Product secret and OAuth bindings that shared runtime policy must not require. */
export type ForbiddenProductBinding =
	| "OPENCODE_API_KEY"
	| "BETTER_AUTH_SECRET"
	| "GITHUB_CLIENT_SECRET"
	| "GITHUB_APP_CLIENT_ID"
	| "GITHUB_APP_PRIVATE_KEY"
	| "GITHUB_APP_ID";

/**
 * Explicit bindings capacity policy may require. Capacity does not read Worker
 * secrets; callers may pass a richer env to injected executors via the generic.
 */
export type WorkspaceRuntimeCapacityEnv = {
	readonly __workspaceRuntimeCapacity?: never;
};

/** Sandbox identity mapping used by workspace-runtime helpers. */
export type WorkspaceSandboxEnv = {
	Sandbox: {
		idFromName: (name: string) => { toString(): string };
	};
};

type AssertNoForbiddenBindings<T> =
	Extract<keyof T, ForbiddenProductBinding> extends never ? true : never;

export type WorkspaceRuntimeCapacityEnvHasNoProductSecrets =
	AssertNoForbiddenBindings<WorkspaceRuntimeCapacityEnv>;

export type WorkspaceSandboxEnvHasNoProductSecrets =
	AssertNoForbiddenBindings<WorkspaceSandboxEnv>;
