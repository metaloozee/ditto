import base from "../../../../../../apps/credential-tests/vitest.config.ts";
export default {
 ...base,
 resolve: { ...base.resolve, alias: [
  { find: /^vitest$/, replacement: new URL("../../../../../../apps/credential-tests/node_modules/vitest/dist/index.js", import.meta.url).pathname },
  ...base.resolve.alias,
 ] },
 test: {
  ...base.test,
  include: [new URL("./separate-stub.worker.test.ts", import.meta.url).pathname],
  poolOptions: { ...base.test.poolOptions, workers: {
   ...base.test.poolOptions.workers,
   main: new URL("../a-continuation-entry.ts", import.meta.url).pathname,
   miniflare: { ...base.test.poolOptions.workers.miniflare,
    durableObjects: { ...base.test.poolOptions.workers.miniflare.durableObjects,
     CandidateSessions: { className: "AContinuationSession", useSQLite: true },
     CandidateCredential: { className: "AContinuationCredential", useSQLite: true },
    },
   },
  } },
 },
};
