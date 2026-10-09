import base from "/home/ayan/ditto-execution/plan-007-recovery/apps/credential-tests/vitest.config.ts";
export default {
  ...base,
  test: {
    ...base.test,
    root: "/home/ayan/ditto-execution/plan-007-recovery/apps/credential-tests",
    include: ["../../plans/evidence/artifacts/007/configuration-advisor/product-authority-review.worker.test.ts"],
    poolOptions: { workers: { ...base.test.poolOptions.workers, main: "/home/ayan/ditto-execution/plan-007-recovery/apps/credential-tests/src/model-entry.ts" } },
  },
};
