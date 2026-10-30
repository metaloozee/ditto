import { env, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import type { CandidateFixtureSession } from "./model-entry";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		CandidateSessions: DurableObjectNamespace<CandidateFixtureSession>;
	}
}

it("answers a preview admission from a cold session without opening it", async () => {
	const runtime = env.CandidateSessions.getByName(crypto.randomUUID());
	expect(await runtime.previewAdmit("a".repeat(64))).toBe(false);
	expect(await runtime.previewAdmit("not-hex")).toBe(false);
	await runInDurableObject(runtime, async (_instance, state) => {
		expect(await state.storage.get("candidate-scope-v2")).toBeUndefined();
		expect(
			state.storage.sql
				.exec("SELECT name FROM sqlite_master WHERE name = 'host_meta'")
				.toArray(),
		).toEqual([]);
	});
});
