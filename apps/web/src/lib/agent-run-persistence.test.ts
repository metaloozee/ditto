import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createDb } from "#/db";
import {
	acceptAgentInput,
	advanceAgentRunEpoch,
	LEGAL_AGENT_RUN_TRANSITIONS,
	loadOwnedAgentRun,
	requestAgentRunStop,
	settleTurnAssistant,
	transitionAgentRun,
} from "./agent-run-persistence";

const migrationsDir = resolve(process.cwd(), "migrations");
const migrationFiles = readdirSync(migrationsDir)
	.filter((file) => /^\d{4}_.*\.sql$/.test(file))
	.sort();

function migrate(sqlite: DatabaseSync) {
	sqlite.exec("PRAGMA foreign_keys=ON");
	for (const file of migrationFiles)
		for (const statement of readFileSync(resolve(migrationsDir, file), "utf8")
			.split("--> statement-breakpoint")
			.map((part) => part.trim())
			.filter(Boolean))
			sqlite.exec(statement);
}

function makeDb(options: { failAt?: number } = {}) {
	const sqlite = new DatabaseSync(":memory:");
	migrate(sqlite);
	const prepared = (query: string, args: unknown[] = []) => {
		const statement = sqlite.prepare(query);
		const bound = {
			bind: (...values: unknown[]) => prepared(query, values),
			all: async () => ({ results: statement.all(...(args as never[])) }),
			run: async () => {
				const result = statement.run(...(args as never[]));
				return { results: [], meta: { changes: Number(result.changes) } };
			},
		};
		return bound;
	};
	let batchQueue = Promise.resolve();
	const client = {
		prepare: (query: string) => prepared(query),
		batch: (
			statements: Array<{
				run: () => Promise<{ results: unknown[]; meta: { changes: number } }>;
			}>,
		) => {
			const operation = batchQueue.then(async () => {
				sqlite.exec("BEGIN");
				try {
					const results = [];
					for (const [index, statement] of statements.entries()) {
						if (options.failAt === index)
							throw new Error("injected batch failure");
						results.push(await statement.run());
					}
					sqlite.exec("COMMIT");
					return results;
				} catch (cause) {
					sqlite.exec("ROLLBACK");
					throw cause;
				}
			});
			batchQueue = operation.then(
				() => undefined,
				() => undefined,
			);
			return operation;
		},
	};
	const db = createDb({ DB: client as never });
	sqlite
		.prepare(
			"INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)",
		)
		.run("u1", "User", "u1@example.test", 0, 1, 1);
	sqlite
		.prepare("INSERT INTO projects (id,name,userId,status) VALUES (?,?,?,?)")
		.run("p1", "Project", "u1", "ready");
	sqlite
		.prepare(
			"INSERT INTO workspace_sessions (id,projectId,userId,status) VALUES (?,?,?,?)",
		)
		.run("s1", "p1", "u1", "active");
	return { db, sqlite };
}
const scope = { userId: "u1", projectId: "p1", workspaceSessionId: "s1" };

describe("agent-run persistence", () => {
	it("accepts atomically, appends, and returns exact duplicates", async () => {
		const { db, sqlite } = makeDb();
		const first = await acceptAgentInput({
			db,
			...scope,
			requestId: "req-1",
			message: "hello",
			modelSpecifier: "model",
			createId: (() => {
				let n = 0;
				return () => `id-${++n}`;
			})(),
			now: () => 1000,
		});
		expect(first).toMatchObject({
			runId: "id-1",
			sequence: 1,
			createdRun: true,
			duplicate: false,
		});
		expect(
			sqlite
				.prepare(
					"SELECT workspaceSessionId,projectId,userId FROM turns WHERE id=?",
				)
				.get("id-2"),
		).toEqual({ workspaceSessionId: "s1", projectId: "p1", userId: "u1" });
		const second = await acceptAgentInput({
			db,
			...scope,
			requestId: "req-2",
			message: "again",
			modelSpecifier: "model",
			createId: (() => {
				let n = 10;
				return () => `id-${++n}`;
			})(),
			now: () => 2000,
		});
		expect(second).toMatchObject({
			runId: "id-1",
			sequence: 2,
			createdRun: false,
		});
		const duplicate = await acceptAgentInput({
			db,
			...scope,
			requestId: "req-1",
			message: "hello",
			modelSpecifier: "model",
		});
		expect(duplicate).toMatchObject({
			runId: "id-1",
			sequence: 1,
			duplicate: true,
		});
		expect(sqlite.prepare("SELECT COUNT(*) AS count FROM turns").get()).toEqual(
			{ count: 2 },
		);
	});

	it("routes input after stop to one successor and preserves predecessor", async () => {
		const { db } = makeDb();
		const first = await acceptAgentInput({
			db,
			...scope,
			requestId: "req-1",
			message: "hello",
			modelSpecifier: "model",
			createId: (() => {
				let n = 0;
				return () => `id-${++n}`;
			})(),
		});
		if ("kind" in first) throw new Error("setup failed");
		await requestAgentRunStop({
			db,
			...scope,
			runId: first.runId,
			requestId: "stop-1",
		});
		const next = await acceptAgentInput({
			db,
			...scope,
			requestId: "req-2",
			message: "next",
			modelSpecifier: "model",
			createId: (() => {
				let n = 20;
				return () => `id-${++n}`;
			})(),
		});
		expect(next).toMatchObject({ createdRun: true, sequence: 1 });
		const run = await loadOwnedAgentRun({ db, ...scope, runId: first.runId });
		expect(run && !("kind" in run) ? run.run.status : "").toBe("stopping");
	});

	it("enforces CAS lifecycle, epochs, terminal settlement, and ownership", async () => {
		const { db } = makeDb();
		const created = await acceptAgentInput({
			db,
			...scope,
			requestId: "req-1",
			message: "hello",
			modelSpecifier: "model",
			createId: (() => {
				let n = 0;
				return () => `id-${++n}`;
			})(),
		});
		if ("kind" in created) throw new Error("setup failed");
		expect(
			await transitionAgentRun({
				db,
				...scope,
				runId: created.runId,
				from: "accepted",
				to: "running",
				expectedEpoch: null,
			}),
		).toMatchObject({ status: "running", epoch: 1 });
		expect(
			await advanceAgentRunEpoch({
				db,
				...scope,
				runId: created.runId,
				expectedEpoch: 1,
			}),
		).toEqual({ epoch: 2 });
		expect(
			await advanceAgentRunEpoch({
				db,
				...scope,
				runId: created.runId,
				expectedEpoch: 1,
			}),
		).toMatchObject({ kind: "error", code: "stale" });
		expect(
			await transitionAgentRun({
				db,
				...scope,
				runId: created.runId,
				from: "running",
				to: "finalizing",
				expectedEpoch: 2,
			}),
		).toMatchObject({ status: "finalizing" });
		expect(
			await transitionAgentRun({
				db,
				...scope,
				runId: created.runId,
				from: "finalizing",
				to: "completed",
				expectedEpoch: 2,
			}),
		).toMatchObject({ kind: "error", code: "stale" });
		expect(
			await settleTurnAssistant({
				db,
				...scope,
				turnId: created.turnId,
				content: "done",
				status: "complete",
			}),
		).toEqual({ status: "complete" });
		expect(
			await transitionAgentRun({
				db,
				...scope,
				runId: created.runId,
				from: "finalizing",
				to: "completed",
				expectedEpoch: 2,
			}),
		).toMatchObject({ status: "completed" });
		expect(
			await settleTurnAssistant({
				db,
				...scope,
				turnId: created.turnId,
				content: "different",
				status: "complete",
			}),
		).toMatchObject({ kind: "error", code: "idempotency_conflict" });
		expect(
			await transitionAgentRun({
				db,
				...scope,
				runId: created.runId,
				from: "completed",
				to: "running",
			}),
		).toMatchObject({ kind: "error", code: "invalid" });
		expect(
			await advanceAgentRunEpoch({
				db,
				userId: "u2",
				projectId: "p1",
				workspaceSessionId: "s1",
				runId: created.runId,
				expectedEpoch: 2,
			}),
		).toMatchObject({ kind: "error", code: "not_found" });
		const foreign = await loadOwnedAgentRun({
			db,
			userId: "u2",
			projectId: "p1",
			workspaceSessionId: "s1",
			runId: created.runId,
		});
		expect(foreign).toBeNull();
	});

	it("transition table covers every 8x8 lifecycle pair", async () => {
		for (const from of [
			"accepted",
			"running",
			"stopping",
			"finalizing",
			"completed",
			"failed",
			"cancelled",
			"interrupted",
		] as const) {
			for (const to of [
				"accepted",
				"running",
				"stopping",
				"finalizing",
				"completed",
				"failed",
				"cancelled",
				"interrupted",
			] as const) {
				const { db, sqlite } = makeDb();
				const created = await acceptAgentInput({
					db,
					...scope,
					requestId: "matrix",
					message: "hello",
					modelSpecifier: "model",
					createId: (() => {
						let n = 0;
						return () => `matrix-${++n}`;
					})(),
				});
				if ("kind" in created) throw new Error("matrix setup failed");
				sqlite
					.prepare(
						"UPDATE messages SET status='complete',content='done' WHERE id=?",
					)
					.run(created.assistantMessageId);
				const terminal = [
					"completed",
					"failed",
					"cancelled",
					"interrupted",
				].includes(from);
				sqlite
					.prepare(
						"UPDATE agent_runs SET status=?,finishedAt=?,currentExecutionEpoch=? WHERE id=?",
					)
					.run(
						from,
						terminal ? 1 : null,
						from === "accepted" ? null : 1,
						created.runId,
					);
				const result = await transitionAgentRun({
					db,
					...scope,
					runId: created.runId,
					from,
					to,
					expectedEpoch: from === "accepted" ? null : 1,
				});
				const legal = LEGAL_AGENT_RUN_TRANSITIONS[from].includes(to);
				expect("kind" in result).toBe(!legal);
			}
		}
	});

	it("acceptance conflict, rollback, race and successor filters cover named paths", async () => {
		const { db, sqlite } = makeDb();
		const first = await acceptAgentInput({
			db,
			...scope,
			requestId: "conflict",
			message: "one",
			modelSpecifier: "model",
			createId: (() => {
				let n = 0;
				return () => `conflict-${++n}`;
			})(),
		});
		if ("kind" in first) throw new Error("conflict setup failed");
		const conflict = await acceptAgentInput({
			db,
			...scope,
			requestId: "conflict",
			message: "two",
			modelSpecifier: "model",
		});
		expect(conflict).toMatchObject({
			kind: "error",
			code: "idempotency_conflict",
		});
		expect(sqlite.prepare("SELECT COUNT(*) AS count FROM turns").get()).toEqual(
			{ count: 1 },
		);
		const stop = await requestAgentRunStop({
			db,
			...scope,
			runId: first.runId,
			requestId: "stop",
		});
		expect(stop).toMatchObject({ accepted: true, status: "stopping" });
		const successor = await acceptAgentInput({
			db,
			...scope,
			requestId: "successor",
			message: "two",
			modelSpecifier: "model",
			createId: (() => {
				let n = 20;
				return () => `successor-${++n}`;
			})(),
		});
		expect(successor).toMatchObject({ createdRun: true, sequence: 1 });
		expect(
			sqlite.prepare("SELECT COUNT(*) AS count FROM agent_runs").get(),
		).toEqual({ count: 2 });

		const finalized = makeDb();
		const finalizedRun = await acceptAgentInput({
			db: finalized.db,
			...scope,
			requestId: "finalizing-input",
			message: "before finalize",
			modelSpecifier: "model",
		});
		if ("kind" in finalizedRun) throw new Error("finalizing setup failed");
		await requestAgentRunStop({
			db: finalized.db,
			...scope,
			runId: finalizedRun.runId,
			requestId: "finalizing-stop",
		});
		const finalizing = await transitionAgentRun({
			db: finalized.db,
			...scope,
			runId: finalizedRun.runId,
			from: "stopping",
			to: "finalizing",
		});
		expect(finalizing).toMatchObject({ status: "finalizing" });
		const rerouted = await acceptAgentInput({
			db: finalized.db,
			...scope,
			requestId: "rerouted",
			message: "after finalize",
			modelSpecifier: "model",
		});
		if ("kind" in rerouted) throw new Error("reroute failed");
		expect(rerouted).toMatchObject({ createdRun: true, sequence: 1 });
		expect(
			finalized.sqlite
				.prepare("SELECT sequence FROM agent_runs WHERE id=?")
				.get(rerouted.runId),
		).toEqual({ sequence: 2 });

		for (let failAt = 0; failAt < 7; failAt++) {
			const failed = makeDb({ failAt });
			await expect(
				acceptAgentInput({
					db: failed.db,
					...scope,
					requestId: `rollback-${failAt}`,
					message: "rollback",
					modelSpecifier: "model",
					createId: (() => {
						let n = 0;
						return () => `rollback-${failAt}-${++n}`;
					})(),
				}),
			).rejects.toThrow("injected batch failure");
			expect(
				failed.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_runs").get(),
			).toEqual({ count: 0 });
			expect(
				failed.sqlite.prepare("SELECT COUNT(*) AS count FROM turns").get(),
			).toEqual({ count: 0 });
			expect(
				failed.sqlite.prepare("SELECT COUNT(*) AS count FROM messages").get(),
			).toEqual({ count: 0 });
		}

		const raced = makeDb();
		const initial = await acceptAgentInput({
			db: raced.db,
			...scope,
			requestId: "race-initial",
			message: "initial",
			modelSpecifier: "model",
			createId: (() => {
				let n = 0;
				return () => `race-${++n}`;
			})(),
		});
		if ("kind" in initial) throw new Error("race setup failed");
		await requestAgentRunStop({
			db: raced.db,
			...scope,
			runId: initial.runId,
			requestId: "race-stop",
		});
		const racedResults = await Promise.all([
			acceptAgentInput({
				db: raced.db,
				...scope,
				requestId: "race-a",
				message: "a",
				modelSpecifier: "model",
				createId: (() => {
					let n = 0;
					return () => `race-a-${++n}`;
				})(),
			}),
			acceptAgentInput({
				db: raced.db,
				...scope,
				requestId: "race-b",
				message: "b",
				modelSpecifier: "model",
				createId: (() => {
					let n = 0;
					return () => `race-b-${++n}`;
				})(),
			}),
		]);
		expect(racedResults.every((result) => !("kind" in result))).toBe(true);
		expect(
			raced.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_runs").get(),
		).toEqual({ count: 2 });
		expect(
			raced.sqlite
				.prepare("SELECT sequence FROM turns ORDER BY sequence")
				.all(),
		).toEqual([{ sequence: 1 }, { sequence: 1 }, { sequence: 2 }]);
	});

	it("ownership returns not_found for foreign, archived, and mismatched operations", async () => {
		const { db, sqlite } = makeDb();
		const created = await acceptAgentInput({
			db,
			...scope,
			requestId: "owned",
			message: "owned",
			modelSpecifier: "model",
		});
		if ("kind" in created) throw new Error("ownership setup failed");
		const foreign = { userId: "u2", projectId: "p2", workspaceSessionId: "s2" };
		const foreignLoad = await loadOwnedAgentRun({
			db,
			...foreign,
			runId: created.runId,
		});
		expect(foreignLoad).toBeNull();
		for (const result of [
			await requestAgentRunStop({
				db,
				...foreign,
				runId: created.runId,
				requestId: "foreign-stop",
			}),
			await transitionAgentRun({
				db,
				...foreign,
				runId: created.runId,
				from: "accepted",
				to: "running",
			}),
			await advanceAgentRunEpoch({
				db,
				...foreign,
				runId: created.runId,
				expectedEpoch: 1,
			}),
			await settleTurnAssistant({
				db,
				...foreign,
				turnId: created.turnId,
				status: "complete",
				content: "x",
			}),
		])
			expect(result).toMatchObject({ kind: "error", code: "not_found" });
		sqlite
			.prepare("UPDATE workspace_sessions SET status='archived' WHERE id='s1'")
			.run();
		expect(
			await acceptAgentInput({
				db,
				...scope,
				requestId: "archived",
				message: "x",
				modelSpecifier: "model",
			}),
		).toMatchObject({ kind: "error", code: "not_found" });
		expect(
			await requestAgentRunStop({
				db,
				...scope,
				runId: "wrong",
				requestId: "stop",
			}),
		).toMatchObject({ kind: "error", code: "not_found" });
		expect(
			await settleTurnAssistant({
				db,
				...scope,
				turnId: "wrong",
				status: "complete",
				content: "x",
			}),
		).toMatchObject({ kind: "error", code: "not_found" });
	});
});
