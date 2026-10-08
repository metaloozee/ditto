import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
	test: {
		include: ["src/**/*.worker.test.ts"],
		poolOptions: {
			workers: {
				main: "./src/entry.ts",
				miniflare: {
					compatibilityDate: "2026-03-10",
					compatibilityFlags: ["nodejs_compat"],
					d1Databases: ["DB"],
					durableObjects: { CodexCredential: { className: "FixtureCredential", useSQLite: true } },
					bindings: {
						CODEX_CREDENTIAL_CURRENT_KEY_VERSION: "fixture-v1",
						CODEX_CREDENTIAL_KEYS: JSON.stringify({ "fixture-v1": "01".repeat(32) }),
					},
				},
			},
		},
	},
});
