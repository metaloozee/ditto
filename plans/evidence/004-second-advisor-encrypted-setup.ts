import { vi } from "vitest";
import { PiDurableHost } from "../../apps/runtime/src/pi-durable-host.ts";
import { importRuntimeKeyringFromBytes } from "../../apps/runtime/src/runtime-crypto.ts";

const original = PiDurableHost.open.bind(PiDurableHost);
vi.spyOn(PiDurableHost, "open").mockImplementation(async (storage, dependencies) => {
	const retained = dependencies.retained ?? {
		ownerId: "advisor-extra-owner",
		workspaceSessionId: "advisor-extra-session",
		keyring: await importRuntimeKeyringFromBytes("v1", {
			v1: new Uint8Array(32).fill(11),
		}),
	};
	return original(storage, { ...dependencies, retained });
});
