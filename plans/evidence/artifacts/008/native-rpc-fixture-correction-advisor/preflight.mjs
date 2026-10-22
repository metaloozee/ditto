import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const root = "/home/ayan/ditto-execution/plan-008-4WXvNW";
const require = createRequire(root + "/apps/credential-tests/vitest.config.ts");
const { build } = require("esbuild");
const built = await build({ absWorkingDir: root + "/apps/credential-tests", entryPoints: [root + "/plans/evidence/artifacts/008/native-rpc-fixture-correction/receiver.ts"], outfile: root + "/.execution-008/native-rpc-fixture-correction/receiver.mjs", bundle:true, format:"esm", platform:"node", target:"es2022", external:["cloudflare:*"], metafile:true });
writeFileSync(root + "/plans/evidence/artifacts/008/native-rpc-fixture-correction/preflight-build-metafile.json", JSON.stringify(built.metafile,null,2)+"\n");
