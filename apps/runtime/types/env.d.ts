interface Env {
	PRODUCT: Service<import("../src/server").ProductEntrypoint>;
	RUNTIME: Service<import("../src/server").RuntimeEntrypoint>;
	SessionRuntime: DurableObjectNamespace<import("../src/server").SessionRuntime>;
	Sandbox: DurableObjectNamespace<import("../src/server").Sandbox>;
}
