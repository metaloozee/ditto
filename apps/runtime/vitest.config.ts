import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
	test: {
		deps: {
			optimizer: {
				ssr: {
					enabled: true,
					include: ["@cloudflare/containers", "@cloudflare/sandbox"],
				},
			},
		},
		poolOptions: {
			workers: {
				main: "./src/server.ts",
				additionalExports: {
					SessionRuntime: "DurableObject",
					Sandbox: "DurableObject",
					RuntimeEntrypoint: "WorkerEntrypoint",
					ProductEntrypoint: "WorkerEntrypoint",
				},
				miniflare: {
					compatibilityDate: "2026-09-16",
					compatibilityFlags: ["nodejs_compat"],
				},
			},
		},
	},
});
