interface Env {
	PRODUCT: Service<import("../src/server").ProductEntrypoint>;
	RUNTIME: Service<import("../src/server").RuntimeEntrypoint>;
	SessionRuntime: DurableObjectNamespace<
		import("../src/server").SessionRuntime
	>;
	Sandbox: DurableObjectNamespace<import("../src/server").Sandbox>;
	RUNTIME_ENCRYPTION_CURRENT_KEY_VERSION: string;
	RUNTIME_ENCRYPTION_KEYS: string;
}
