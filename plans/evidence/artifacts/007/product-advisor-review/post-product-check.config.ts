import base from "/home/ayan/ditto-execution/plan-007-recovery/apps/runtime/vitest.config.ts";
export default {
	...base,
	test: {
		...base.test,
		root: "/home/ayan/ditto-execution/plan-007-recovery/apps/runtime",
		include: ["../../plans/evidence/artifacts/007/product-advisor-review/post-product-check.probe.test.ts"],
		poolOptions: { workers: { ...base.test.poolOptions.workers, main: "/home/ayan/ditto-execution/plan-007-recovery/apps/runtime/src/pi-durable-test-entry.ts" } },
	},
};
