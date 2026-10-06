import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import { configDefaults } from "vitest/config";

export default defineWorkersConfig({
	test: {
		exclude: [...configDefaults.exclude, "src/pi-durable-imports.test.mjs"],
		deps: {
			optimizer: {
				ssr: {
					enabled: true,
					include: ["@cloudflare/containers", "@cloudflare/sandbox", "@earendil-works/pi-durable", "@earendil-works/pi-durable/storage/sqlite", "@earendil-works/pi-durable/testing", "@earendil-works/pi-ai/models", "@earendil-works/pi-ai/providers/faux", "@earendil-works/chord/context", "@earendil-works/chord/delta", "typebox"],
				},
			},
		},
		poolOptions: {
			workers: {
				main: "./src/pi-durable-test-entry.ts",
				additionalExports: {
					SessionRuntime: "DurableObject",
					Sandbox: "DurableObject",
					RuntimeEntrypoint: "WorkerEntrypoint",
					ProductEntrypoint: "WorkerEntrypoint",
					PiDurableLocalRuntime: "DurableObject",
				},
				miniflare: {
					compatibilityDate: "2026-09-16",
					compatibilityFlags: ["nodejs_compat"],
					durableObjects: {
						PI_FIXTURE_STORAGE: { className: "PiDurableLocalRuntime", useSQLite: true },
						PI_HOST_STORAGE: { className: "PiDurableHostFixture", useSQLite: true },
					},
					bindings: {
						PI_HOST_FIXTURE_CLOCK_OFFSET_MS: 60_000,
						RUNTIME_ENCRYPTION_CURRENT_KEY_VERSION: "v1",
						RUNTIME_ENCRYPTION_KEYS: JSON.stringify({
							v1: "01".repeat(32),
						}),
					},
				},
			},
		},
	},
});
