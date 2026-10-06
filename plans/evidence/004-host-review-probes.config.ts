import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { defineWorkersConfig } = require("/tmp/ditto-plan-004-vO7JVp/apps/runtime/node_modules/@cloudflare/vitest-pool-workers/dist/config/index.cjs");

const runtime = "/tmp/ditto-plan-004-vO7JVp/apps/runtime";
export default defineWorkersConfig({
	root: runtime,
	resolve: {
		alias: [
			{ find: /^vitest$/, replacement: `${runtime}/node_modules/vitest/dist/index.js` },
			{ find: /^@earendil-works\/chord\/context$/, replacement: `${runtime}/node_modules/@earendil-works/chord/dist/context/index.js` },
			{ find: /^@earendil-works\/pi-durable$/, replacement: `${runtime}/node_modules/@earendil-works/pi-durable/dist/index.js` },
		],
	},
	test: {
		deps: { optimizer: { ssr: { enabled: true, include: ["@cloudflare/containers", "@cloudflare/sandbox", "@earendil-works/pi-durable", "@earendil-works/pi-durable/storage/sqlite", "@earendil-works/pi-ai/models", "@earendil-works/pi-ai/providers/faux", "@earendil-works/chord/context", "@earendil-works/chord/delta", "typebox"] } } },
		include: ["../../plans/evidence/004-host-review-probes.test.ts"],
		poolOptions: {
			workers: {
				main: `${runtime}/src/pi-durable-test-entry.ts`,
				additionalExports: { SessionRuntime: "DurableObject", Sandbox: "DurableObject", RuntimeEntrypoint: "WorkerEntrypoint", ProductEntrypoint: "WorkerEntrypoint", PiDurableLocalRuntime: "DurableObject" },
				miniflare: {
					compatibilityDate: "2026-03-10", compatibilityFlags: ["nodejs_compat"],
					durableObjects: { PI_HOST_STORAGE: { className: "PiDurableHostFixture", useSQLite: true } },
				},
			},
		},
	},
});
