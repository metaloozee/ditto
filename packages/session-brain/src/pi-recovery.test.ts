import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	assistantToolUse,
	buildRestorationFixture,
	checkpointFromFixture,
} from "./main.ts";
import {
	type Authority,
	BARRIER_NAMES,
	type BarrierName,
	type CrashPosition,
	isLatched,
	type JournalEffect,
	loadJournal,
	loadReceipts,
	type RecoveryJournal,
	recoverCommittedBatch,
	runLiveToolPersistenceFailure,
	saveJournal,
	saveReceipts,
} from "./pi-recovery.ts";

const roots: string[] = [];
const authority: Authority = { incarnation: "brain-1", epoch: 1, attempt: 1 };
const nodeLauncher = "/home/ayan/.vite-plus/bin/node";
afterAll(() => {
	for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
function makeRoot() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ditto-brain-"));
	roots.push(root);
	return root;
}
function makeEffect(
	index: number,
	state: JournalEffect["state"],
): JournalEffect {
	const suffix = index === 0 ? "a" : "b";
	return {
		runId: "run-1",
		assistantEntryId: "ent-a1",
		toolCallId: `call-${suffix}`,
		toolName: `tool_${suffix}`,
		arguments: { n: index + 1 },
		state,
	};
}
function seed(options?: {
	states?: [JournalEffect["state"], JournalEffect["state"]];
	followUps?: Array<{ commandId: string; text: string }>;
	fullFixture?: boolean;
	terminal?: boolean;
}) {
	const root = makeRoot();
	const checkpoint = checkpointFromFixture(buildRestorationFixture(root));
	if (!options?.fullFixture) {
		checkpoint.fileEntries = checkpoint.fileEntries.slice(0, 5);
		checkpoint.leafId = "ent-a1";
	}
	checkpoint.terminal = options?.terminal ?? false;
	if (checkpoint.terminal) checkpoint.terminalContent = "already done";
	const assistant = assistantToolUse({
		provider: "offline",
		model: "offline-1",
		api: "faux",
		timestamp: 5,
		calls: [
			{ id: "call-a", name: "tool_a", arguments: { n: 1 } },
			{ id: "call-b", name: "tool_b", arguments: { n: 2 } },
		],
	});
	const entry = checkpoint.fileEntries.find(
		(item) => item.type === "message" && item.id === "ent-a1",
	);
	if (entry?.type === "message") entry.message = assistant;
	checkpoint.committedProviderResponses = [assistant];
	const states = options?.states ?? ["prepared", "prepared"];
	const effects = options?.fullFixture
		? []
		: [makeEffect(0, states[0]), makeEffect(1, states[1])];
	for (const effect of effects)
		if (effect.state === "result_recorded" || effect.state === "materialized") {
			effect.result = {
				content: [
					{ type: "text", text: `${effect.toolName}:${effect.arguments.n}` },
				],
				isError: false,
			};
			checkpoint.actualToolResults.push({
				role: "toolResult",
				toolCallId: effect.toolCallId,
				toolName: effect.toolName,
				content: structuredClone(effect.result.content),
				isError: false,
				timestamp: 5,
			});
		}
	const followUps = options?.followUps ?? [];
	const journal: RecoveryJournal = {
		authority,
		runId: "run-1",
		assistantEntryId: options?.fullFixture ? checkpoint.leafId : "ent-a1",
		checkpoint,
		effects,
		acceptedCommandIds: followUps.map((item) => item.commandId),
		consumedCommandIds: [],
		followUps,
	};
	saveJournal(root, journal);
	return { root, journal };
}
const recover = (root: string) => recoverCommittedBatch(root, root, authority);
async function runChild(
	root: string,
	barrier: BarrierName,
	pauseAt: CrashPosition | "never",
	kill: boolean,
) {
	const request = path.join(
		root,
		`${kill ? "kill" : "restart"}-${barrier}-${pauseAt}.json`,
	);
	fs.writeFileSync(
		request,
		JSON.stringify({
			action: "barrier",
			journalDir: root,
			barrier,
			pauseAt,
		}),
	);
	const child = spawn(nodeLauncher, ["src/restoration-child.ts", request], {
		cwd: process.cwd(),
		stdio: ["ignore", kill ? "pipe" : "ignore", "ignore"],
	});
	if (kill)
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error(`timeout ${barrier}/${pauseAt}`)),
				12_000,
			);
			child.stdout?.setEncoding("utf8");
			child.stdout?.on("data", (chunk: string) => {
				if (!chunk.includes(`POINT ${pauseAt}`)) return;
				clearTimeout(timeout);
				child.kill("SIGKILL");
				resolve();
			});
			child.once("error", reject);
		});
	const code = await new Promise<number | null>((resolve, reject) => {
		child.once("exit", resolve);
		child.once("error", reject);
	});
	if (!kill) expect(code).toBe(0);
}
describe("journal-led recovery", () => {
	it("R01 executes a committed A/B batch once before the next inference", async () => {
		const { root } = seed();
		const result = await recover(root);
		expect(result.status).toBe("terminal");
		expect(result.providerCalls).toBe(1);
		expect(result.providerMessages?.at(-1)).toMatchObject({
			role: "toolResult",
			toolCallId: "call-b",
		});
		expect(
			result.providerMessages?.filter((message) => message.role === "user"),
		).toHaveLength(1);
		expect(result.receipts).toMatchObject({
			"call-a": { count: 1 },
			"call-b": { count: 1 },
		});
		expect(
			loadJournal(root).effects.every(
				(effect) => effect.state === "materialized",
			),
		).toBe(true);
	});
	it("R02 reuses A's recorded result and dispatches only B", async () => {
		const { root } = seed({ states: ["result_recorded", "prepared"] });
		saveReceipts(root, { "call-a": { count: 1, output: "tool_a:1" } });
		const result = await recover(root);
		expect(result.receipts["call-a"].count).toBe(1);
		expect(result.receipts["call-b"].count).toBe(1);
		expect(result.providerMessages?.slice(-2)).toMatchObject([
			{ role: "toolResult", toolCallId: "call-a" },
			{ role: "toolResult", toolCallId: "call-b" },
		]);
		expect(
			loadJournal(root).checkpoint.actualToolResults.map(
				(item) => item.toolCallId,
			),
		).toContain("call-a");
	});
	it("R03 dispatches nothing when all authentic results are committed", async () => {
		const { root } = seed({ states: ["result_recorded", "result_recorded"] });
		saveReceipts(root, {
			"call-a": { count: 1, output: "tool_a:1" },
			"call-b": { count: 1, output: "tool_b:2" },
		});
		const before = structuredClone(loadReceipts(root));
		const result = await recover(root);
		expect(loadReceipts(root)).toEqual(before);
		expect(result.providerMessages?.at(-1)).toMatchObject({
			role: "toolResult",
			toolCallId: "call-b",
		});
	});
	it("R04 returns a committed terminal answer without provider or tools", async () => {
		const { root } = seed({ terminal: true });
		expect(await recover(root)).toMatchObject({
			status: "terminal",
			providerCalls: 0,
			terminalContent: "already done",
		});
	});
	it("R05 blocks an admitted tool with an unknown outcome", async () => {
		const { root } = seed({ states: ["admitted", "prepared"] });
		saveReceipts(root, { "call-a": { count: 1, output: "tool_a:1" } });
		expect(await recover(root)).toMatchObject({
			status: "blocked",
			providerCalls: 0,
		});
		expect(loadReceipts(root)["call-a"].count).toBe(1);
	});
	it("R06 preserves materialized result entry IDs across process replacement", async () => {
		const { root } = seed({ states: ["result_recorded", "result_recorded"] });
		await recover(root);
		const before = loadJournal(root).effects.map((effect) => effect.piEntryId);
		expect(await recover(root)).toMatchObject({
			status: "terminal",
			providerCalls: 0,
		});
		expect(loadJournal(root).effects.map((effect) => effect.piEntryId)).toEqual(
			before,
		);
	});
	it("R07 preserves compaction and consumes identical follow-ups by command ID", async () => {
		const { root } = seed({
			fullFixture: true,
			followUps: [
				{ commandId: "cmd-1", text: "same text" },
				{ commandId: "cmd-2", text: "same text" },
			],
		});
		await recover(root);
		await recover(root);
		const journal = loadJournal(root);
		expect(journal.consumedCommandIds).toEqual(["cmd-1", "cmd-2"]);
		expect(
			journal.checkpoint.fileEntries.filter(
				(entry) =>
					entry.type === "message" &&
					entry.message.role === "user" &&
					entry.message.content === "same text",
			),
		).toHaveLength(2);
		expect(
			journal.checkpoint.fileEntries.some(
				(entry) =>
					entry.type === "compaction" && entry.firstKeptEntryId === "ent-r0",
			),
		).toBe(true);
	});
	it("blocks explicit outcome_unknown without replay", async () => {
		const { root } = seed({ states: ["outcome_unknown", "prepared"] });
		saveReceipts(root, { "call-a": { count: 1, output: "tool_a:1" } });
		expect(await recover(root)).toMatchObject({
			status: "blocked",
			providerCalls: 0,
		});
		expect(loadReceipts(root)["call-a"].count).toBe(1);
	});
	it("rejects stale incarnation, epoch, and attempt authority", async () => {
		const { root } = seed();
		await expect(
			recoverCommittedBatch(root, root, { ...authority, epoch: 2 }),
		).rejects.toThrow(/stale/);
		expect(loadReceipts(root)).toEqual({});
	});
});
describe("awaited durability barriers", () => {
	const positions: CrashPosition[] = [
		"before-persist",
		"after-persist-before-ack",
		"after-ack-before-next",
	];
	function seedBarrier(barrier: BarrierName) {
		return seed({
			fullFixture: true,
			followUps:
				barrier === "follow-up"
					? [{ commandId: "cmd-follow", text: "follow-up instruction" }]
					: [],
		});
	}
	function expectSemanticPersistence(
		barrier: BarrierName,
		journal: RecoveryJournal,
		persisted: boolean,
	) {
		if (barrier === "initial-command") {
			expect(journal.initialCommand !== undefined).toBe(persisted);
			expect(journal.consumedCommandIds.includes("cmd-initial")).toBe(
				persisted,
			);
			if (persisted)
				expect(
					journal.checkpoint.fileEntries.some(
						(entry) =>
							entry.type === "message" &&
							entry.message.role === "user" &&
							entry.message.content === "initial instruction",
					),
				).toBe(true);
			return;
		}
		if (barrier === "follow-up") {
			expect(journal.consumedCommandIds.includes("cmd-follow")).toBe(persisted);
			if (persisted)
				expect(
					journal.checkpoint.fileEntries.filter(
						(entry) =>
							entry.type === "message" &&
							entry.message.role === "user" &&
							entry.message.content === "follow-up instruction",
					),
				).toHaveLength(1);
			return;
		}
		if (barrier === "assistant-tools") {
			expect(journal.assistantResponseEntryId !== undefined).toBe(persisted);
			if (persisted)
				expect(journal.effects.map((effect) => effect.state)).toEqual([
					"prepared",
					"prepared",
				]);
			return;
		}
		if (barrier === "tool-result") {
			const effect = journal.effects.find(
				(item) => item.toolCallId === "call-a",
			);
			expect(effect?.state).toBe(persisted ? "result_recorded" : "admitted");
			expect(
				journal.checkpoint.actualToolResults.some(
					(result) =>
						result.toolCallId === "call-a" &&
						result.content.some(
							(block) =>
								block.type === "text" && block.text === "normalized:tool_a:1",
						),
				),
			).toBe(persisted);
			return;
		}
		if (barrier === "final-answer") {
			expect(journal.checkpoint.terminal).toBe(persisted);
			expect(journal.checkpoint.terminalContent).toBe(
				persisted ? "final answer" : undefined,
			);
			return;
		}
		if (barrier === "compaction") {
			expect(journal.compactionEntryId !== undefined).toBe(persisted);
			if (persisted) {
				const compaction = journal.checkpoint.fileEntries.find(
					(entry) => entry.id === journal.compactionEntryId,
				);
				expect(compaction).toMatchObject({
					type: "compaction",
					summary: "hook-owned compaction summary",
				});
				expect(journal.checkpoint.leafId).toBe(journal.compactionEntryId);
			}
			return;
		}
		if (barrier === "extension-state") {
			expect(
				journal.extensionTransitions?.some(
					(transition) =>
						transition.toolCallId === "call-a" &&
						transition.phase === "authorized" &&
						transition.leafId === journal.assistantResponseEntryId,
				) ?? false,
			).toBe(persisted);
			expect(journal.checkpoint.extensionState).toEqual(
				persisted
					? { phase: "authorized", toolCallId: "call-a" }
					: { phase: "ready" },
			);
			return;
		}
		expect(journal.spendingAttempts).toEqual(
			persisted ? [{ kind: "provider", sequence: 1 }] : undefined,
		);
	}
	for (const barrier of BARRIER_NAMES)
		for (const position of positions)
			it.concurrent(`${barrier}: SIGKILL ${position} and restart`, async () => {
				const { root } = seedBarrier(barrier);
				await runChild(root, barrier, position, true);
				const interrupted = loadJournal(root);
				expectSemanticPersistence(
					barrier,
					interrupted,
					position !== "before-persist",
				);
				await runChild(root, barrier, "never", false);
				const recovered = loadJournal(root);
				if (barrier === "tool-result" && position === "before-persist") {
					expect(
						recovered.effects.find((effect) => effect.toolCallId === "call-a")
							?.state,
					).toBe("outcome_unknown");
					expect(recovered.checkpoint.terminal).toBe(false);
				} else if (barrier === "compaction") {
					expect(
						recovered.checkpoint.fileEntries.filter(
							(entry) =>
								entry.type === "compaction" &&
								entry.summary === "hook-owned compaction summary",
						),
					).toHaveLength(1);
				} else if (barrier === "spending-attempt") {
					expect(recovered.spendingAttempts).toEqual([
						{ kind: "provider", sequence: 1 },
						{ kind: "retry", sequence: 2 },
						{ kind: "compaction", sequence: 3 },
						{ kind: "metadata", sequence: 4 },
					]);
				} else {
					expect(recovered.checkpoint.terminal).toBe(true);
				}
				if (barrier === "assistant-tools" || barrier === "extension-state")
					expect(loadReceipts(root)).toMatchObject({
						"call-a": { count: 1 },
						"call-b": { count: 1 },
					});
			}, 25_000);
	it("latches admissions when live tool-result persistence fails and stays blocked after reopen", async () => {
		const { root } = seed({ fullFixture: true });
		const result = await runLiveToolPersistenceFailure(root, root, authority);
		expect(result).toMatchObject({ status: "blocked", providerCalls: 1 });
		expect(isLatched(root)).toBe(true);
		expect(loadReceipts(root)).toMatchObject({ "call-a": { count: 1 } });
		expect(loadReceipts(root)["call-b"]).toBeUndefined();
		expect(await recover(root)).toMatchObject({
			status: "blocked",
			providerCalls: 0,
		});
	});
});
