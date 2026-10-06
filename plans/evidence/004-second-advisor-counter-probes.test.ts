import { env, runInDurableObject } from "cloudflare:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ROOT_CONVERSATION_ID, type EntryId, type TaskId } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { EncryptedPiStorage } from "../../apps/runtime/src/pi-durable-storage.ts";
import { importRuntimeKeyringFromBytes } from "../../apps/runtime/src/runtime-crypto.ts";
async function binding() {
	return { ownerId: "advisor-counter-owner", workspaceSessionId: "advisor-counter-session", keyring: await importRuntimeKeyringFromBytes("v1", { v1: new Uint8Array(32).fill(13) }) };
}
it("advisor: regressed durable sequence cannot create a commit before authenticated history", async () => {
	await runInDurableObject(env.PI_HOST_STORAGE.getByName("004-final-sequence-counter"), async (_instance, state) => {
		const retained = await binding();
		const first = await EncryptedPiStorage.open(state.storage, retained);
		await first.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], BACKGROUND_CONTEXT);
		const id = await first.mintId<EntryId>();
		const before = await first.commit([{ type: "entry", value: { id, conversationId: ROOT_CONVERSATION_ID, kind: "note", data: { text: "before" } } }], BACKGROUND_CONTEXT);
		await first.close(BACKGROUND_CONTEXT);
		state.storage.sql.exec("UPDATE durable_metadata SET next_seq = 1");
		let blocked = false;
		let after: number | undefined;
		let reopened: EncryptedPiStorage | undefined;
		try {
			reopened = await EncryptedPiStorage.open(state.storage, retained);
			const next = await reopened.mintId<EntryId>();
			after = await reopened.commit([{ type: "entry", value: { id: next, conversationId: ROOT_CONVERSATION_ID, kind: "note", data: { text: "after" } } }], BACKGROUND_CONTEXT);
		} catch { blocked = true; } finally { await reopened?.close(BACKGROUND_CONTEXT); }
		expect({ blocked, before, after }, "corrupt counter must be denied before minting authenticated new history").toMatchObject({ blocked: true, after: undefined });
	});
});
it("advisor: regressed durable ID cannot mint a live task ID and overwrite its authenticated checkpoint", async () => {
	await runInDurableObject(env.PI_HOST_STORAGE.getByName("004-final-id-counter"), async (_instance, state) => {
		const retained = await binding();
		const first = await EncryptedPiStorage.open(state.storage, retained);
		const task = await first.mintId<TaskId>();
		await first.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }, { type: "task", value: { id: task, conversationId: ROOT_CONVERSATION_ID, kind: "pi.tool", version: 1, input: { original: true }, state: { status: "running", checkpoint: { phase: "execute", original: true } } } }], BACKGROUND_CONTEXT);
		await first.close(BACKGROUND_CONTEXT);
		state.storage.sql.exec("UPDATE durable_metadata SET next_id = ?", String(task));
		let blocked = false;
		let minted: number | undefined;
		let replaced: unknown;
		let reopened: EncryptedPiStorage | undefined;
		try {
			reopened = await EncryptedPiStorage.open(state.storage, retained);
			minted = await reopened.mintId<TaskId>();
			await reopened.commit([{ type: "task", value: { id: minted as TaskId, conversationId: ROOT_CONVERSATION_ID, kind: "pi.tool", version: 1, input: { replacement: true }, state: { status: "running", checkpoint: { phase: "execute", replacement: true } } } }], BACKGROUND_CONTEXT);
			replaced = (await reopened.task(task, BACKGROUND_CONTEXT))?.state.checkpoint;
		} catch { blocked = true; } finally { await reopened?.close(BACKGROUND_CONTEXT); }
		expect({ blocked, task, minted, replaced }, "counter must not turn a newly minted task into an overwrite of live retained work").toMatchObject({ blocked: true, minted: undefined, replaced: undefined });
	});
});
