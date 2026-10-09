import base from "/home/ayan/ditto-execution/plan-007-recovery/apps/credential-tests/vitest.config.ts";
export default {
 ...base,
 cacheDir: "/home/ayan/ditto-execution/plan-007-recovery/plans/evidence/artifacts/007/configuration-advisor/cache",
 test: {...base.test,
  include: ["/home/ayan/ditto-execution/plan-007-recovery/plans/evidence/artifacts/007/configuration-advisor/probes.worker.test.ts"],
  poolOptions: {workers: {...base.test.poolOptions.workers, main: "/home/ayan/ditto-execution/plan-007-recovery/apps/credential-tests/src/model-entry.ts"}}
 }
};
