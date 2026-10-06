import { env, runInDurableObject } from "cloudflare:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ROOT_CONVERSATION_ID, type EntryId } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { EncryptedPiStorage } from "../../apps/runtime/src/pi-durable-storage.ts";
import { importRuntimeKeyringFromBytes } from "../../apps/runtime/src/runtime-crypto.ts";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}
async function setup(storage: DurableObjectStorage) {
	const binding = {
		ownerId: "advisor-owner", workspaceSessionId: "advisor-session",
		keyring: await importRuntimeKeyringFromBytes("v1", { v1: new Uint8Array(32).fill(5) }),
	};
	const adapter = await EncryptedPiStorage.open(storage, binding);
	await adapter.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], BACKGROUND_CONTEXT);
	return adapter;
}
function holdEncryption(adapter: EncryptedPiStorage, id: number, reject: boolean) {
	const entered = deferred();
	const release = deferred();
	const original: unknown = Reflect.get(adapter, "encodeText");
	if (typeof original !== "function") throw new Error("Missing synthetic encryption fault seam");
	Reflect.set(adapter, "encodeText", async (plain: string, recordId: string) => {
		if (recordId === `entries/${id}`) {
			entered.resolve();
			await release.promise;
			if (reject) throw new Error("Synthetic encryption rejection");
		}
		return original.call(adapter, plain, recordId);
	});
	return { entered: entered.promise, release: release.resolve };
}
function entry(id: EntryId) {
	return { type: "entry" as const, value: { id, conversationId: ROOT_CONVERSATION_ID, kind: "note", data: { text: "advisor-synthetic" } } };
}

it("advisor: public read excludes an unfinished commit that will roll back", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("advisor-read-exclusion");
	await runInDurableObject(stub, async (_instance, state) => {
		const adapter = await setup(state.storage);
		const first = await adapter.mintId<EntryId>();
		const second = await adapter.mintId<EntryId>();
		const gate = holdEncryption(adapter, second, true);
		const commit = adapter.commit([entry(first), entry(second)], BACKGROUND_CONTEXT).then(() => null, (error: unknown) => error);
		await gate.entered;
		let readSettled = false;
		const reading = adapter.entry(first, BACKGROUND_CONTEXT).then((value) => { readSettled = true; return value; });
		await new Promise((resolve) => setTimeout(resolve, 30));
		const prematurelySettled = readSettled;
		gate.release();
		const failure = await commit;
		const result = await reading;
		const after = await adapter.entry(first, BACKGROUND_CONTEXT);
		await adapter.close(BACKGROUND_CONTEXT);
		expect(failure).toBeInstanceOf(Error);
		expect(after).toBeUndefined();
		expect(result, "rolled-back private content must not escape through a public read").toBeUndefined();
		expect(prematurelySettled, "read must wait for rollback, not expose rolled-back content").toBe(false);
	});
});

it("advisor: close joins an admitted commit before reporting completion", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("advisor-close-commit");
	await runInDurableObject(stub, async (_instance, state) => {
		const adapter = await setup(state.storage);
		const id = await adapter.mintId<EntryId>();
		const gate = holdEncryption(adapter, id, false);
		const commit = adapter.commit([entry(id)], BACKGROUND_CONTEXT);
		await gate.entered;
		let closeSettled = false;
		const closing = adapter.close(BACKGROUND_CONTEXT).then(() => { closeSettled = true; });
		await new Promise((resolve) => setTimeout(resolve, 30));
		const prematurelyClosed = closeSettled;
		gate.release();
		await commit;
		await closing;
		expect(prematurelyClosed, "close cannot finish while its admitted writer remains live").toBe(false);
	});
});

it("advisor: unrelated synchronous safety transition survives a Pi rollback", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("advisor-safety-rollback");
	await runInDurableObject(stub, async (_instance, state) => {
		const adapter = await setup(state.storage);
		state.storage.sql.exec("CREATE TABLE advisor_safety (epoch INTEGER NOT NULL)");
		state.storage.sql.exec("INSERT INTO advisor_safety VALUES (1)");
		const id = await adapter.mintId<EntryId>();
		const gate = holdEncryption(adapter, id, true);
		const commit = adapter.commit([entry(id)], BACKGROUND_CONTEXT).then(() => null, (error: unknown) => error);
		await gate.entered;
		state.storage.transactionSync(() => { state.storage.sql.exec("UPDATE advisor_safety SET epoch = 2"); });
		gate.release();
		await commit;
		const epoch = state.storage.sql.exec<{ epoch: number }>("SELECT epoch FROM advisor_safety").one().epoch;
		await adapter.close(BACKGROUND_CONTEXT);
		expect(epoch, "Pi rollback must not rewind a separate priority safety write").toBe(2);
	});
});
