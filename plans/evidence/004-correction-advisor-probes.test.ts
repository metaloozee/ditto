import { env, runInDurableObject } from "cloudflare:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ROOT_CONVERSATION_ID, type DocumentId, type EntryId } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { EncryptedPiStorage } from "../../apps/runtime/src/pi-durable-storage.ts";
import { importRuntimeKeyringFromBytes } from "../../apps/runtime/src/runtime-crypto.ts";

async function binding() {
	return { ownerId: "advisor-owner", workspaceSessionId: "advisor-workspace", keyring: await importRuntimeKeyringFromBytes("v1", { v1: new Uint8Array(32).fill(6) }) };
}

it("advisor correction: a SQL failure after partial apply rolls back the batch", async () => {
	await runInDurableObject(env.PI_HOST_STORAGE.getByName("correction-sql-rollback"), async (_instance, state) => {
		const b = await binding();
		const pi = await EncryptedPiStorage.open(state.storage, b);
		await pi.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], BACKGROUND_CONTEXT);
		state.storage.sql.exec("CREATE UNIQUE INDEX advisor_fault_index ON entries (conversation_id)");
		const ids = [await pi.mintId<EntryId>(), await pi.mintId<EntryId>()];
		const writes = ids.map((id) => ({ type: "entry" as const, value: { id, conversationId: ROOT_CONVERSATION_ID, kind: "note", data: { text: "synthetic" } } }));
		await expect(pi.commit(writes, BACKGROUND_CONTEXT)).rejects.toThrow();
		expect(state.storage.sql.exec("SELECT * FROM entries").toArray()).toHaveLength(0);
		expect(state.storage.sql.exec("SELECT * FROM record_ids WHERE record_type = 'entry'").toArray()).toHaveLength(0);
		expect(state.storage.sql.exec<{ next_seq: number }>("SELECT next_seq FROM durable_metadata").one().next_seq).toBe(2);
		await pi.close(BACKGROUND_CONTEXT);
		const reopened = await EncryptedPiStorage.open(state.storage, b);
		expect(await reopened.entry(ids[0], BACKGROUND_CONTEXT)).toBeUndefined();
		await reopened.close(BACKGROUND_CONTEXT);
	});
});

it("advisor correction: document definition version tampering fails closed", async () => {
	await runInDurableObject(env.PI_HOST_STORAGE.getByName("correction-doc-version"), async (_instance, state) => {
		const b = await binding();
		const pi = await EncryptedPiStorage.open(state.storage, b);
		const id = await pi.mintId<DocumentId>();
		await pi.commit([{ type: "document.create", record: { id, kind: "app.note", scope: { kind: "session" } }, content: { kind: "base", version: 1, value: { text: "synthetic-v1" } } }], BACKGROUND_CONTEXT);
		await pi.close(BACKGROUND_CONTEXT);
		state.storage.sql.exec("UPDATE document_revisions SET version = 99 WHERE document_id = ?", id);
		let failure: unknown;
		let returned: unknown;
		let reopened: EncryptedPiStorage | undefined;
		try { reopened = await EncryptedPiStorage.open(state.storage, b); returned = await reopened.document(id, "current", BACKGROUND_CONTEXT); } catch (error) { failure = error; } finally { await reopened?.close(BACKGROUND_CONTEXT); }
		expect({ failure: failure instanceof Error, returned }).toMatchObject({ failure: true, returned: undefined });
	});
});

it("advisor correction: entry routing metadata tampering fails closed", async () => {
	await runInDurableObject(env.PI_HOST_STORAGE.getByName("correction-entry-route"), async (_instance, state) => {
		const b = await binding();
		const pi = await EncryptedPiStorage.open(state.storage, b);
		await pi.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], BACKGROUND_CONTEXT);
		const id = await pi.mintId<EntryId>();
		await pi.commit([{ type: "entry", value: { id, conversationId: ROOT_CONVERSATION_ID, kind: "note", data: { text: "synthetic" } } }], BACKGROUND_CONTEXT);
		await pi.close(BACKGROUND_CONTEXT);
		state.storage.sql.exec("UPDATE entries SET conversation_id = 999 WHERE id = ?", id);
		let failed = false;
		let reopened: EncryptedPiStorage | undefined;
		try { reopened = await EncryptedPiStorage.open(state.storage, b); await reopened.scanEntries({ conversationId: ROOT_CONVERSATION_ID }, 20, undefined, BACKGROUND_CONTEXT); } catch { failed = true; } finally { await reopened?.close(BACKGROUND_CONTEXT); }
		expect(failed, "routing tamper cannot silently hide authenticated history").toBe(true);
	});
});
