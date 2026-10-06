import { env, runInDurableObject } from "cloudflare:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ROOT_CONVERSATION_ID, type EntryId } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { EncryptedPiStorage } from "../../apps/runtime/src/pi-durable-storage.ts";
import { importRuntimeKeyringFromBytes } from "../../apps/runtime/src/runtime-crypto.ts";

it("advisor: synchronous rejection after counter application rolls back the envelope and complete batch", async () => {
	await runInDurableObject(env.PI_HOST_STORAGE.getByName("004-counter-advisor-full-rollback"), async (_instance, state) => {
		const retained = {
			ownerId: "advisor-atomic-owner",
			workspaceSessionId: "advisor-atomic-session",
			keyring: await importRuntimeKeyringFromBytes("v1", { v1: new Uint8Array(32).fill(14) }),
		};
		const counter = () => state.storage.sql.exec<{ next_id: string; next_seq: number; counter_record: string }>("SELECT next_id,next_seq,counter_record FROM durable_metadata").one();
		let reject = false;
		let witnessed: { entry: boolean; claim: boolean; counters: boolean } | undefined;
		let before: ReturnType<typeof counter>;
		const storage = new Proxy(state.storage, {
			get(target, key) {
				if (key === "transactionSync") return <T>(fn: () => T): T => target.transactionSync(() => {
					const result = fn();
					if (reject) {
						const changed = counter();
						witnessed = {
							entry: state.storage.sql.exec("SELECT id FROM entries").toArray().length === 1,
							claim: state.storage.sql.exec("SELECT id FROM record_ids WHERE record_type='entry'").toArray().length === 1,
							counters: changed.next_seq === before.next_seq + 1 && changed.counter_record !== before.counter_record && changed.next_id !== before.next_id,
						};
						throw new Error("Synthetic synchronous rejection after counter update");
					}
					return result;
				});
				const value: unknown = Reflect.get(target, key, target);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		const opened = await EncryptedPiStorage.open(storage, retained);
		await opened.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], BACKGROUND_CONTEXT);
		before = counter();
		const id = await opened.mintId<EntryId>();
		reject = true;
		await expect(opened.commit([{ type: "entry", value: { id, conversationId: ROOT_CONVERSATION_ID, kind: "note", data: { text: "Synthetic atomic record" } } }], BACKGROUND_CONTEXT)).rejects.toThrow(/after counter update/);
		expect(witnessed).toEqual({ entry: true, claim: true, counters: true });
		expect(counter()).toEqual(before);
		expect(state.storage.sql.exec("SELECT id FROM entries").toArray()).toEqual([]);
		expect(state.storage.sql.exec("SELECT id FROM record_ids WHERE record_type='entry'").toArray()).toEqual([]);
		reject = false;
		await opened.close(BACKGROUND_CONTEXT);
		const reopened = await EncryptedPiStorage.open(state.storage, retained);
		expect(await reopened.entry(id, BACKGROUND_CONTEXT)).toBeUndefined();
		expect(counter()).toEqual(before);
		expect(await reopened.mintId<EntryId>()).toBe(id);
		await reopened.close(BACKGROUND_CONTEXT);
	});
});
