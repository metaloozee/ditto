import base from "./004-second-advisor-extra-l1.config.ts";
export default {
	...base,
	test: {
		...base.test,
		setupFiles: ["../../plans/evidence/004-second-advisor-race-setup.ts"],
	},
};
