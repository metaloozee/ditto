import base from "../configuration-advisor/acceptance-probes.config.ts";
export default {
	...base,
	cacheDir: "/home/ayan/ditto-execution/plan-007-recovery/plans/evidence/artifacts/007/configuration-correction/snapshot-cache",
	test: {
		...base.test,
		include: ["/home/ayan/ditto-execution/plan-007-recovery/plans/evidence/artifacts/007/configuration-correction/snapshots.worker.test.ts"],
	},
};
