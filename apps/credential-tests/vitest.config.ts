import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
const runtimeImporter = new URL("../runtime/src/pi-durable-models.ts", import.meta.url).pathname;

export default defineWorkersConfig({
	resolve: { alias: [
		{ find: "@earendil-works", replacement: "@earendil-works", customResolver(id) { return this.resolve(id, runtimeImporter, { skipSelf: true }); } },
		{ find: "typebox", replacement: "typebox", customResolver(id) { return this.resolve(id, runtimeImporter, { skipSelf: true }); } },
		{ find: "@cloudflare", replacement: "@cloudflare", customResolver(id) { return this.resolve(id, runtimeImporter, { skipSelf: true }); } },
	] },
	test: {
		include: ["src/**/*.worker.test.ts"],
		deps: { optimizer: { ssr: { enabled: true, include: ["@cloudflare/containers", "@cloudflare/sandbox", "@earendil-works/pi-durable", "@earendil-works/pi-durable/storage/sqlite", "@earendil-works/pi-ai/models", "@earendil-works/pi-ai/providers/faux", "@earendil-works/chord/context", "@earendil-works/chord/delta", "typebox"] } } },
		poolOptions: {
			workers: {
				main: "./src/model-entry.ts",
				miniflare: {
					compatibilityDate: "2026-03-10",
					compatibilityFlags: ["nodejs_compat"],
					d1Databases: ["DB"],
					durableObjects: {
						CodexCredential: { className: "FixtureCredential", useSQLite: true },
						PI_MODEL_HOST: { className: "PiDurableHostFixture", useSQLite: true },
					},
					bindings: {
						CODEX_CREDENTIAL_CURRENT_KEY_VERSION: "fixture-v1",
						CODEX_CREDENTIAL_KEYS: JSON.stringify({ "fixture-v1": "01".repeat(32) }),
					},
				},
			},
		},
	},
});
