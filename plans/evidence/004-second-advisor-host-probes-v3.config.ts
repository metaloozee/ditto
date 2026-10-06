import base from "./004-second-advisor-host-probes.config.ts";
export default {
	...base,
	test: {
		...base.test,
		include: ["../../plans/evidence/004-second-advisor-host-probes-v3.test.ts"],
	},
};
