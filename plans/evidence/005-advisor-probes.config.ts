import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const runtime = "/tmp/ditto-plan-005-MmLBKB/apps/runtime";
const { defineWorkersConfig } = require(`${runtime}/node_modules/@cloudflare/vitest-pool-workers/dist/config/index.cjs`);
export default defineWorkersConfig({
 root: runtime,
 resolve: { alias: [
  { find: /^vitest$/, replacement: `${runtime}/node_modules/vitest/dist/index.js` },
  { find: /^@earendil-works\/chord\/context$/, replacement: `${runtime}/node_modules/@earendil-works/chord/dist/context/index.js` },
  { find: /^@earendil-works\/pi-durable$/, replacement: `${runtime}/node_modules/@earendil-works/pi-durable/dist/index.js` },
 ] },
 test: {
  include: ["../../plans/evidence/005-advisor-probes.test.ts"],
  deps: { optimizer: { ssr: { enabled: true, include: ["@cloudflare/containers", "@cloudflare/sandbox", "@earendil-works/pi-durable", "@earendil-works/pi-durable/storage/sqlite", "@earendil-works/pi-ai/models", "@earendil-works/pi-ai/providers/faux", "@earendil-works/chord/context", "@earendil-works/chord/delta", "typebox"] } } },
  poolOptions: { workers: {
   main: `${runtime}/src/pi-durable-test-entry.ts`,
   additionalExports: { SessionRuntime: "DurableObject", Sandbox: "DurableObject", RuntimeEntrypoint: "WorkerEntrypoint", ProductEntrypoint: "WorkerEntrypoint", PiDurableLocalRuntime: "DurableObject" },
   miniflare: {
    compatibilityDate: "2026-03-10", compatibilityFlags: ["nodejs_compat"],
    durableObjects: { PI_HOST_STORAGE: { className: "PiDurableHostFixture", useSQLite: true } },
   },
  } },
 },
});
