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

function makeDb(
	options: { failAt?: number; beforeBatch?: () => void | Promise<void> } = {},
) {
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
				await options.beforeBatch?.();
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
		.prepare(
			"INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)",
		)
		.run("u2", "Other", "u2@example.test", 0, 1, 1);
	sqlite
		.prepare("INSERT INTO projects (id,name,userId,status) VALUES (?,?,?,?)")
		.run("p1", "Project", "u1", "ready");
	sqlite
		.prepare("INSERT INTO projects (id,name,userId,status) VALUES (?,?,?,?)")
		.run("p2", "Other", "u2", "ready");
	sqlite
		.prepare(
			"INSERT INTO workspace_sessions (id,projectId,userId,status) VALUES (?,?,?,?)",
		)
		.run("s1", "p1", "u1", "active");
	sqlite
		.prepare(
			"INSERT INTO workspace_sessions (id,projectId,userId,status) VALUES (?,?,?,?)",
		)
		.run("s2", "p2", "u2", "active");
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
		for (const foreign of [
			{ userId: "u2", projectId: "p1", workspaceSessionId: "s1" },
			{ userId: "u1", projectId: "p2", workspaceSessionId: "s1" },
			{ userId: "u1", projectId: "p1", workspaceSessionId: "s2" },
		]) {
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
		}
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
			await loadOwnedAgentRun({ db, ...scope, runId: created.runId }),
		).toBeNull();
		expect(
			await transitionAgentRun({
				db,
				...scope,
				runId: created.runId,
				from: "accepted",
				to: "running",
			}),
		).toMatchObject({ kind: "error", code: "not_found" });
		expect(
			await advanceAgentRunEpoch({
				db,
				...scope,
				runId: created.runId,
				expectedEpoch: 1,
			}),
		).toMatchObject({ kind: "error", code: "not_found" });
		expect(
			await settleTurnAssistant({
				db,
				...scope,
				turnId: created.turnId,
				status: "complete",
				content: "x",
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

	it("race interleavings reroute, archive, and deduplicate atomically", async () => {
		let stopped = false;
		const stoppingOptions: { beforeBatch?: () => void } = {};
		const stopping = makeDb(stoppingOptions);
		const initialStopping = await acceptAgentInput({
			db: stopping.db,
			...scope,
			requestId: "race-initial",
			message: "initial",
			modelSpecifier: "model",
			createId: (() => {
				let n = 0;
				return () => `race-run-${++n}`;
			})(),
		});
		if ("kind" in initialStopping) throw new Error("interleaving setup failed");
		stoppingOptions.beforeBatch = () => {
			if (stopped) return;
			stopped = true;
			stopping.sqlite
				.prepare("UPDATE agent_runs SET status='stopping' WHERE id=?")
				.run(initialStopping.runId);
		};
		const rerouted = await acceptAgentInput({
			db: stopping.db,
			...scope,
			requestId: "race-reroute",
			message: "reroute",
			modelSpecifier: "model",
			createId: (() => {
				let n = 0;
				return () => `race-successor-${++n}`;
			})(),
		});
		if ("kind" in rerouted) throw new Error("reroute setup failed");
		expect(rerouted.createdRun).toBe(true);
		expect(
			stopping.sqlite
				.prepare("SELECT status FROM agent_runs WHERE id=?")
				.get(initialStopping.runId),
		).toEqual({ status: "stopping" });
		expect(
			stopping.sqlite.prepare("SELECT COUNT(*) AS count FROM turns").get(),
		).toEqual({ count: 2 });

		let archived = false;
		const archivedOptions: { beforeBatch?: () => void } = {};
		const archivedDb = makeDb(archivedOptions);
		archivedOptions.beforeBatch = () => {
			if (archived) return;
			archived = true;
			archivedDb.sqlite
				.prepare(
					"UPDATE workspace_sessions SET status='archived' WHERE id='s1'",
				)
				.run();
		};
		const archiveResult = await acceptAgentInput({
			db: archivedDb.db,
			...scope,
			requestId: "race-archive",
			message: "archive",
			modelSpecifier: "model",
		});
		expect(archiveResult).toMatchObject({ kind: "error", code: "not_found" });
		expect(
			archivedDb.sqlite
				.prepare("SELECT COUNT(*) AS count FROM agent_runs")
				.get(),
		).toEqual({ count: 0 });
		expect(
			archivedDb.sqlite.prepare("SELECT COUNT(*) AS count FROM turns").get(),
		).toEqual({ count: 0 });

		const concurrent = makeDb();
		const concurrentResults = await Promise.all(
			["same-a", "same-b"].map((requestId) =>
				acceptAgentInput({
					db: concurrent.db,
					...scope,
					requestId: "same-request",
					message: "same",
					modelSpecifier: "model",
					createId: (() => {
						let n = 0;
						return () => `${requestId}-${++n}`;
					})(),
				}),
			),
		);
		expect(concurrentResults[0]).toMatchObject({
			runId: (concurrentResults[1] as { runId: string }).runId,
			turnId: (concurrentResults[1] as { turnId: string }).turnId,
			userMessageId: (concurrentResults[1] as { userMessageId: string })
				.userMessageId,
			assistantMessageId: (
				concurrentResults[1] as { assistantMessageId: string }
			).assistantMessageId,
		});
		expect(
			concurrent.sqlite.prepare("SELECT COUNT(*) AS count FROM turns").get(),
		).toEqual({ count: 1 });
	});

	it("routes every stopping, finalizing, and terminal state to one unchanged successor", async () => {
		for (const state of [
			"stopping",
			"finalizing",
			"completed",
			"failed",
			"cancelled",
			"interrupted",
		] as const) {
			const { db, sqlite } = makeDb();
			const predecessor = await acceptAgentInput({
				db,
				...scope,
				requestId: `before-${state}`,
				message: "before",
				modelSpecifier: "model",
			});
			if ("kind" in predecessor) throw new Error("successor setup failed");
			const before = sqlite
				.prepare("SELECT * FROM agent_runs WHERE id=?")
				.get(predecessor.runId);
			sqlite
				.prepare("UPDATE agent_runs SET status=?,finishedAt=? WHERE id=?")
				.run(
					state,
					["completed", "failed", "cancelled", "interrupted"].includes(state)
						? 1
						: null,
					predecessor.runId,
				);
			const expected = sqlite
				.prepare("SELECT * FROM agent_runs WHERE id=?")
				.get(predecessor.runId);
			const successor = await acceptAgentInput({
				db,
				...scope,
				requestId: `after-${state}`,
				message: "after",
				modelSpecifier: "model",
			});
			if ("kind" in successor) throw new Error(`successor failed for ${state}`);
			expect(successor.createdRun).toBe(true);
			expect(
				sqlite
					.prepare("SELECT * FROM agent_runs WHERE id=?")
					.get(predecessor.runId),
			).toEqual(expected);
			expect(
				sqlite
					.prepare("SELECT predecessorRunId FROM agent_runs WHERE id=?")
					.get(successor.runId),
			).toEqual({ predecessorRunId: predecessor.runId });
			const duplicate = await acceptAgentInput({
				db,
				...scope,
				requestId: `after-${state}`,
				message: "after",
				modelSpecifier: "model",
			});
			expect(duplicate).toMatchObject({
				duplicate: true,
				runId: successor.runId,
				turnId: successor.turnId,
			});
			expect(before).toBeTruthy();
		}
	});

	it("covers stop idempotency, assistant settlement, outcome validation, and whitespace inputs", async () => {
		const accepted = makeDb();
		const acceptedRun = await acceptAgentInput({
			db: accepted.db,
			...scope,
			requestId: "stop-accepted",
			message: "x",
			modelSpecifier: "model",
		});
		if ("kind" in acceptedRun) throw new Error("stop setup failed");
		expect(
			await requestAgentRunStop({
				db: accepted.db,
				...scope,
				runId: acceptedRun.runId,
				requestId: "stop",
			}),
		).toEqual({ accepted: true, status: "stopping" });
		expect(
			await requestAgentRunStop({
				db: accepted.db,
				...scope,
				runId: acceptedRun.runId,
				requestId: "stop-again",
			}),
		).toEqual({ accepted: false, status: "stopping" });

		const running = makeDb();
		const runningRun = await acceptAgentInput({
			db: running.db,
			...scope,
			requestId: "stop-running",
			message: "x",
			modelSpecifier: "model",
		});
		if ("kind" in runningRun) throw new Error("running setup failed");
		await transitionAgentRun({
			db: running.db,
			...scope,
			runId: runningRun.runId,
			from: "accepted",
			to: "running",
			expectedEpoch: null,
		});
		expect(
			await requestAgentRunStop({
				db: running.db,
				...scope,
				runId: runningRun.runId,
				requestId: "stop-running",
			}),
		).toEqual({ accepted: true, status: "stopping" });

		for (const state of [
			"finalizing",
			"completed",
			"failed",
			"cancelled",
			"interrupted",
		] as const) {
			const terminal = makeDb();
			const run = await acceptAgentInput({
				db: terminal.db,
				...scope,
				requestId: `stop-${state}`,
				message: "x",
				modelSpecifier: "model",
			});
			if ("kind" in run) throw new Error("terminal stop setup failed");
			terminal.sqlite
				.prepare("UPDATE agent_runs SET status=?,finishedAt=? WHERE id=?")
				.run(
					state,
					["completed", "failed", "cancelled", "interrupted"].includes(state)
						? 1
						: null,
					run.runId,
				);
			const before = terminal.sqlite
				.prepare("SELECT * FROM agent_runs WHERE id=?")
				.get(run.runId);
			expect(
				await requestAgentRunStop({
					db: terminal.db,
					...scope,
					runId: run.runId,
					requestId: "late-stop",
				}),
			).toEqual({ accepted: false, status: state });
			expect(
				terminal.sqlite
					.prepare("SELECT * FROM agent_runs WHERE id=?")
					.get(run.runId),
			).toEqual(before);
		}

		const failedAssistant = makeDb();
		const failedRun = await acceptAgentInput({
			db: failedAssistant.db,
			...scope,
			requestId: "assistant-failed",
			message: "x",
			modelSpecifier: "model",
		});
		if ("kind" in failedRun) throw new Error("assistant setup failed");
		expect(
			await settleTurnAssistant({
				db: failedAssistant.db,
				...scope,
				turnId: failedRun.turnId,
				status: "failed",
				content: "failure",
				tools: "[]",
			}),
		).toEqual({ status: "failed" });
		expect(
			failedAssistant.sqlite
				.prepare("SELECT content,tools,status FROM messages WHERE id=?")
				.get(failedRun.assistantMessageId),
		).toEqual({ content: "failure", tools: "[]", status: "failed" });
		expect(
			await settleTurnAssistant({
				db: failedAssistant.db,
				...scope,
				turnId: failedRun.turnId,
				status: "failed",
				content: "failure",
				tools: "[]",
			}),
		).toEqual({ status: "failed" });
		expect(
			await settleTurnAssistant({
				db: failedAssistant.db,
				...scope,
				turnId: failedRun.turnId,
				status: "failed",
				content: "different",
				tools: "[]",
			}),
		).toMatchObject({ kind: "error", code: "idempotency_conflict" });

		const invalidOutcome = makeDb();
		const invalidRun = await acceptAgentInput({
			db: invalidOutcome.db,
			...scope,
			requestId: "invalid-outcome",
			message: "x",
			modelSpecifier: "model",
		});
		if ("kind" in invalidRun) throw new Error("outcome setup failed");
		invalidOutcome.sqlite
			.prepare(
				"UPDATE messages SET status='complete',content='done' WHERE id=?",
			)
			.run(invalidRun.assistantMessageId);
		invalidOutcome.sqlite
			.prepare("UPDATE agent_runs SET status='finalizing' WHERE id=?")
			.run(invalidRun.runId);
		const beforeOutcome = invalidOutcome.sqlite
			.prepare("SELECT * FROM agent_runs WHERE id=?")
			.get(invalidRun.runId);
		expect(
			await transitionAgentRun({
				db: invalidOutcome.db,
				...scope,
				runId: invalidRun.runId,
				from: "finalizing",
				to: "completed",
				outcomeCode: "not machine text",
			}),
		).toMatchObject({ kind: "error", code: "invalid" });
		expect(
			await transitionAgentRun({
				db: invalidOutcome.db,
				...scope,
				runId: invalidRun.runId,
				from: "finalizing",
				to: "completed",
				outcomeCode: "x".repeat(129),
			}),
		).toMatchObject({ kind: "error", code: "invalid" });
		expect(
			invalidOutcome.sqlite
				.prepare("SELECT * FROM agent_runs WHERE id=?")
				.get(invalidRun.runId),
		).toEqual(beforeOutcome);

		let ioCount = 0;
		const whitespace = makeDb({ beforeBatch: () => void ioCount++ });
		expect(
			await acceptAgentInput({
				db: whitespace.db,
				userId: " ",
				projectId: "p1",
				workspaceSessionId: "s1",
				requestId: "x",
				message: "x",
				modelSpecifier: "model",
			}),
		).toMatchObject({ kind: "error", code: "invalid" });
		expect(
			await acceptAgentInput({
				db: whitespace.db,
				...scope,
				requestId: " ",
				message: "x",
				modelSpecifier: "model",
			}),
		).toMatchObject({ kind: "error", code: "invalid" });
		expect(
			await acceptAgentInput({
				db: whitespace.db,
				...scope,
				requestId: "x",
				message: "x",
				modelSpecifier: " ",
			}),
		).toMatchObject({ kind: "error", code: "invalid" });
		expect(ioCount).toBe(0);
	});
});
