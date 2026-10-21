import { defineWorkersConfig, type WorkersUserConfig } from "@cloudflare/vitest-pool-workers/config";
import { createRequire } from "node:module";
type Pool = NonNullable<NonNullable<WorkersUserConfig<{}>["test"]>["poolOptions"]>;
type Worker = Exclude<NonNullable<Pool["workers"]>, (...args: never[]) => unknown>;
type CurrentWorker = Extract<NonNullable<NonNullable<Worker["miniflare"]>["serviceBindings"]>[string], symbol>;
const require = createRequire(import.meta.url);
const miniflare: unknown = require(require.resolve("miniflare", { paths: [require.resolve("@cloudflare/vitest-pool-workers/config")] }));
if (!miniflare || typeof miniflare !== "object" || !("kCurrentWorker" in miniflare) || typeof miniflare.kCurrentWorker !== "symbol") throw new Error("Missing installed Miniflare loopback support");
const currentWorker = miniflare.kCurrentWorker as CurrentWorker;
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
					serviceBindings: { CandidateProduct: { name: currentWorker, entrypoint: "CandidateFixtureProduct" } },
					durableObjects: {
						CodexCredential: { className: "FixtureCredential", useSQLite: true },
						PI_MODEL_HOST: { className: "PiDurableHostFixture", useSQLite: true },
						CandidateSessions: { className: "CandidateFixtureSession", useSQLite: true },
						CandidateCredential: { className: "CandidateFixtureCredential", useSQLite: true },
					},
					bindings: {
						CANDIDATE_DISPOSABLE: "008-synthetic",
						CANDIDATE_PROJECT_VALUES_SECRET: "synthetic-015-project-values",
						CANDIDATE_RUNTIME_KEYS: JSON.stringify({ currentVersion: "fixture-v1", keys: { "fixture-v1": "01".repeat(32) } }),
						CODEX_CREDENTIAL_CURRENT_KEY_VERSION: "fixture-v1",
						CODEX_CREDENTIAL_KEYS: JSON.stringify({ "fixture-v1": "01".repeat(32) }),
					},
				},
			},
		},
	},
});
