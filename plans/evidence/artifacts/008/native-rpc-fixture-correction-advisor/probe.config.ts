import base from "../../../../../apps/credential-tests/vitest.config";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const app = new URL("../../../../../apps/credential-tests/", import.meta.url).pathname;
const require = createRequire(app + "vitest.config.ts");
const { build } = require("esbuild") as typeof import("esbuild");
const { kCurrentWorker } = require("miniflare") as typeof import("miniflare");
const output = new URL("../../../../../.execution-008/native-rpc-fixture-correction/receiver.mjs", import.meta.url).pathname;
const database = { DB: "008-native-rpc-fixture-disposable" };
export default async () => {
  const built = await build({ entryPoints: [new URL("./receiver.ts", import.meta.url).pathname], outfile: output,
    bundle: true, format: "esm", platform: "node", target: "es2022", external: ["cloudflare:*"], metafile: true });
  writeFileSync(new URL("./build-metafile.json", import.meta.url), JSON.stringify(built.metafile, null, 2) + "\n");
  const workers = base.test!.poolOptions!.workers;
  if (!workers || typeof workers === "function") throw new Error("Expected pinned static worker config");
  const options = workers.miniflare!;
  return {
    ...base, root: app,
    test: {
      ...base.test,
      include: [new URL("./probe.worker.test.ts", import.meta.url).pathname],
      poolOptions: { ...base.test!.poolOptions, workers: { ...workers, main: app + "src/model-entry.ts",
        miniflare: { ...options, d1Databases: database,
          serviceBindings: { ...options.serviceBindings,
            ScratchCurrent008: { name: kCurrentWorker, entrypoint: "NativeRpcFixtureReceiver" },
            ScratchNative008: { name: "scratch-native-008", entrypoint: "NativeRpcFixtureReceiver" },
          },
          workers: [{ name: "scratch-native-008", modules: true, scriptPath: output, modulesRoot: new URL("../../../../../.execution-008/native-rpc-fixture-correction/", import.meta.url).pathname,
            compatibilityDate: options.compatibilityDate, compatibilityFlags: options.compatibilityFlags,
            d1Databases: database,
            outboundService: () => new Response("External network disabled", { status: 403 }),
          }],
        },
      } },
    },
  };
};
