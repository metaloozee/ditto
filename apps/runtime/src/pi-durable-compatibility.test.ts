import { env, runInDurableObject } from "cloudflare:test";
import type { DurableObject } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
	FIXTURE_ANSWER,
	FIXTURE_MARKER,
	fixtureDatabase,
	runFixture,
} from "./pi-durable-local.ts";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		PI_FIXTURE_STORAGE: DurableObjectNamespace<DurableObject>;
	}
}

describe("Pi Durable synthetic compatibility in workerd", () => {
	it("commits a remote tool result and its answer in DO SQLite", async () => {
		const stub = env.PI_FIXTURE_STORAGE.getByName("synthetic-success");
		await runInDurableObject(stub, async (_instance, state) => {
			const files = new Map<string, string>();
			const path = "/tmp/component-fixture.txt";
			const result = await runFixture(
				state.storage,
				{
					write: async (file, content) => {
						files.set(file, content);
					},
					read: async (file) => files.get(file) ?? "",
				},
				path,
			);
			expect(files.get(path)).toBe(FIXTURE_MARKER);
			expect(result.toolResult).toMatchObject({
				role: "toolResult",
				isError: false,
				content: [{ type: "text", text: FIXTURE_MARKER }],
			});
			expect(result.answer).toMatchObject({
				role: "assistant",
				content: [{ type: "text", text: FIXTURE_ANSWER }],
			});
			expect(
				state.storage.sql.exec("SELECT status FROM submissions").one().status,
			).toBe("done");
		});
	});
	it("fails without an executor and never calls a read fallback", async () => {
		const stub = env.PI_FIXTURE_STORAGE.getByName("synthetic-unavailable");
		await runInDurableObject(stub, async (_instance, state) => {
			let reads = 0;
			await expect(
				runFixture(
					state.storage,
					{
						write: async () => {
							throw new Error("Executor unreachable");
						},
						read: async () => {
							reads++;
							throw new Error("No fallback");
						},
					},
					"/tmp/unreachable-marker.txt",
				),
			).rejects.toThrow("Synthetic turn did not commit an answer");
			expect(reads).toBe(0);
			expect(
				state.storage.sql.exec("SELECT status FROM submissions").one().status,
			).toBe("unanswered");
		});
	});
	it("rolls back SQL and rejects expired transaction handles", async () => {
		const stub = env.PI_FIXTURE_STORAGE.getByName("sql-rollback");
		await runInDurableObject(stub, async (_instance, state) => {
			const db = fixtureDatabase(state.storage);
			await db.exec("CREATE TABLE fixture (value TEXT)");
			let expired: (() => Promise<void>) | undefined;
			await expect(
				db.transaction(async (tx) => {
					expired = () => tx.exec("INSERT INTO fixture VALUES ('expired')");
					await tx.exec("INSERT INTO fixture VALUES ('rolled back')");
					throw new Error("rollback");
				}),
			).rejects.toThrow("rollback");
			expect(await db.all("SELECT * FROM fixture")).toEqual([]);
			await expect(expired?.()).rejects.toThrow("Expired fixture transaction");
			await db.close();
		});
	});
});
