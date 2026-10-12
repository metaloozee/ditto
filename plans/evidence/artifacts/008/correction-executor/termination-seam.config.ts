import runtimeConfig from "../../../../../apps/runtime/vitest.config.ts";
export default {
	...runtimeConfig,
	resolve: { alias: [{ find: /^vitest$/, replacement: new URL("../../../../../apps/runtime/node_modules/vitest/dist/index.js", import.meta.url).pathname }] },
	test: {
		...runtimeConfig.test,
		include: [new URL("./termination-seam.test.ts", import.meta.url).pathname],
		poolOptions: {
			...runtimeConfig.test.poolOptions,
			workers: {
				...runtimeConfig.test.poolOptions.workers,
				main: new URL("../../../../../apps/runtime/src/pi-durable-test-entry.ts", import.meta.url).pathname,
			},
		},
	},
};
