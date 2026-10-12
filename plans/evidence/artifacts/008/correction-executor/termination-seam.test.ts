import { env, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";

it("investigates supported per-object abort without deleting retained SQLite", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("008-termination-seam");
	await runInDurableObject(stub, async (instance, state) => {
		instance.alarmCalls = 73;
		await state.storage.put("008-retained", 73);
		await state.storage.sync();
	});
	await expect(runInDurableObject(stub, async (_instance, state) => {
		state.abort("008 trusted disposable fixture reset");
	})).rejects.toThrow();
	const replacement = env.PI_HOST_STORAGE.getByName("008-termination-seam");
	await runInDurableObject(replacement, async (instance, state) => {
		expect(instance.alarmCalls).toBe(0);
		expect(await state.storage.get("008-retained")).toBe(73);
	});
});
