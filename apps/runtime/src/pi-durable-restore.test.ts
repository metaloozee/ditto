import { env, runInDurableObject } from "cloudflare:test";
import {
	awaitWithContext,
	BACKGROUND_CONTEXT,
	withAbortSignal,
} from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	fauxAssistantMessage,
	fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import {
	createRegistry,
	defineExtension,
	defineTask,
	type EntryId,
	Harness,
	ROOT_CONVERSATION_ID,
} from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { parseCommandV2 } from "../../../packages/runtime-contracts/src/product-command.js";
import {
	command,
	complete,
	fixture,
	pointer,
	seed,
	submissions,
} from "./pi-durable-checkpoint.fixture.ts";
import { PiDurableHost, type PiDurableHostFixture } from "./pi-durable-host.ts";
import { encoder } from "./pi-durable-recovery.fixture.ts";
import { EncryptedPiStorage } from "./pi-durable-storage.ts";
import { importRuntimeKeyringFromBytes } from "./runtime-crypto.ts";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		PI_HOST_STORAGE: DurableObjectNamespace<PiDurableHostFixture>;
	}
}

const context = BACKGROUND_CONTEXT;
const binding = async () => ({
	ownerId: "owner-013",
	workspaceSessionId: "session-013",
	keyring: await importRuntimeKeyringFromBytes("v1", {
		v1: new Uint8Array(32).fill(13),
	}),
});

/**
 * Retirement recipe for restoring an older pair, proven on the pinned Pi
 * Durable public API: abort the old generation across background
 * boundaries, then fork a new ownerless conversation at the pair's entry.
 */
it("retires every old-generation task, queued input and background task, and a fork at the pair entry continues from the pair context", async () => {
	await runInDurableObject(
		env.PI_HOST_STORAGE.getByName("restore-recipe"),
		async (_instance, state) => {
			const faux = fauxProvider({ tokensPerSecond: 0 });
			const models = createModels({
				authContext: {
					env: async () => undefined,
					fileExists: async () => false,
				},
			});
			models.setProvider(faux.provider);
			let backgroundRuns = 0;
			let backgroundAborts = 0;
			const background = defineTask<
				{ label: string },
				{ phase: "work" },
				string,
				object
			>({
				name: "restore.background",
				version: 1,
				initial: () => ({ phase: "work" }),
				phases: {
					work: async (_task, _runtime, taskContext) => {
						backgroundRuns++;
						await awaitWithContext(new Promise<void>(() => {}), taskContext);
					},
				},
				abort: async (_task, runtime) => {
					backgroundAborts++;
					await runtime.commit(
						() => ({
							status: "terminal",
							outcome: { status: "aborted", reason: "restore" },
						}),
						context,
					);
				},
			});
			const extension = defineExtension({
				name: "restore-013",
				tasks: [background],
			});
			const registry = createRegistry();
			registry.install(extension);
			const options = {
				models,
				registry,
				settings: {
					extensions: [extension],
					retry: { enabled: false },
					compaction: { enabled: false, backgroundTokens: 0 },
				},
			};
			const requests: string[] = [];
			const answer = (text: string) => async (transcript: unknown) => {
				requests.push(JSON.stringify(transcript));
				return fauxAssistantMessage(text);
			};
			let storage = await EncryptedPiStorage.open(
				state.storage,
				await binding(),
			);
			let harness = await Harness.open(storage, options, context);
			let root = await harness.root(context, {
				agent: {
					model: {
						provider: faux.getModel().provider,
						modelId: faux.getModel().id,
					},
				},
			});
			faux.setResponses([answer("pair answer"), answer("later answer")]);
			const first = await root.submit(
				{ type: "input", requestId: "first", content: "pair input" },
				context,
			);
			expect((await first.wait(context)).status).toBe("done");
			// The pair: a quiescent position and its exact model context.
			const pairEntry = (await root.entries({}, 1, undefined, context)).items[0]
				?.id as EntryId;
			const pairContext = await root.context(context);
			const later = await root.submit(
				{ type: "input", requestId: "later", content: "later input" },
				context,
			);
			expect((await later.wait(context)).status).toBe("done");

			// Live old-generation work at the moment of loss.
			let entered!: () => void;
			const started = new Promise<void>((resolve) => {
				entered = resolve;
			});
			faux.setResponses([
				async (_transcript, requestOptions) => {
					entered();
					await awaitWithContext(
						new Promise<void>(() => {}),
						requestOptions?.signal
							? withAbortSignal(requestOptions.signal, context)
							: context,
					);
					return fauxAssistantMessage("unreachable");
				},
			]);
			const interrupted = await root.submit(
				{ type: "input", requestId: "interrupted", content: "in flight" },
				context,
			);
			await started;
			const queued = await root.submit(
				{
					type: "input",
					requestId: "queued",
					content: "queued follow-up",
					whenBusy: "followUp",
				},
				context,
			);
			const backgroundTask = await root.commit(
				(tx) =>
					tx.createTask(
						background,
						{ label: "old" },
						{ ownership: { kind: "conversation" }, background: true },
					),
				context,
			);
			await expect.poll(() => backgroundRuns).toBe(1);
			// The executor is lost here: close without settling anything.
			await harness.close(context);
			await storage.close(context);

			// Restore: reopen paused, retire the old generation, then fork.
			storage = await EncryptedPiStorage.open(state.storage, await binding());
			const providerCalls = requests.length;
			faux.setResponses([answer("restored answer")]);
			harness = await Harness.open(storage, options, context);
			expect((await harness.inspect(context)).scheduling).toBe("paused");
			const live = await harness.inspect(context);
			expect(live.tasks.length).toBeGreaterThanOrEqual(2);
			root = (await harness.conversation(ROOT_CONVERSATION_ID, context))!;
			await root.abort(context, { background: true });
			const retired = await harness.inspect(context);
			expect(retired.tasks).toEqual([]);
			expect(retired.submissions).toEqual([]);
			expect(backgroundAborts).toBe(1);
			expect(
				(await harness.getTask(backgroundTask, context))?.state,
			).toMatchObject({
				status: "terminal",
				outcome: { status: "aborted" },
			});
			expect((await storage.submission(interrupted.id, context))?.status).toBe(
				"unanswered",
			);
			expect((await storage.submission(queued.id, context))?.status).toBe(
				"unanswered",
			);
			// Aborting ran no old model request and no queued input.
			expect(requests).toHaveLength(providerCalls);
			const generation = await root.fork(
				pairEntry,
				{ ownership: { kind: "ownerless" } },
				context,
			);
			expect(await generation.context(context)).toEqual(pairContext);
			await harness.close(context);
			await storage.close(context);

			// Reopen and resume: no old work runs, and the new generation continues from the pair.
			storage = await EncryptedPiStorage.open(state.storage, await binding());
			harness = await Harness.open(storage, options, context);
			harness.resume();
			await harness.waitForIdle(context);
			expect(requests).toHaveLength(providerCalls);
			expect(backgroundRuns).toBe(1);
			const resumed = (await harness.conversation(generation.id, context))!;
			const next = await resumed.submit(
				{ type: "input", requestId: "after-restore", content: "after restore" },
				context,
			);
			expect((await next.wait(context)).status).toBe("done");
			expect(requests).toHaveLength(providerCalls + 1);
			const sent = requests.at(-1) ?? "";
			expect(sent).toContain("pair input");
			expect(sent).toContain("pair answer");
			expect(sent).not.toContain("later input");
			expect(sent).not.toContain("in flight");
			expect(sent).not.toContain("queued follow-up");
			// Later history stays inspectable on the old generation.
			const old = (await harness.conversation(ROOT_CONVERSATION_ID, context))!;
			const history = JSON.stringify(
				(await old.entries({}, 50, undefined, context)).items,
			);
			expect(history).toContain("later answer");
			expect((await harness.inspect(context)).tasks).toEqual([]);
			await harness.close(context);
			await storage.close(context);
		},
	);
});

function restoreCommand(sequence: number, pair: string, generation: number) {
	return parseCommandV2({
		version: 2,
		kind: "restore_checkpoint_acknowledging_loss",
		commandId: `restore-${sequence}`,
		commandSeq: sequence,
		userId: "owner",
		projectId: "project",
		workspaceSessionId: "workspace",
		runtimeOwnerVersion: 1,
		receiptId: `restore-receipt-${sequence}`,
		acceptedAt: 1,
		deadlineAt: 900001,
		payloadDigest: "e".repeat(64),
		committedPairId: pair,
		expectedMutationGeneration: generation,
		expectedRecoveryPosition: sequence - 1,
		unbackedLossAcknowledged: true,
	});
}

type Context = Parameters<Parameters<typeof fixture>[1]>[0];

/** Ends the host invocation the way a yield does, then opens the next one. */
async function reopen(context: Context) {
	await context.host().yield();
	await context.host().awaitClosure();
	return context.open();
}

/** Baseline, then command 1 completes and becomes pair 1, then command 2 completes after it. */
async function pairAfterFirst(context: Context) {
	const { storage, control, execution, store } = context;
	let host = await context.open();
	const baseline = await context.publisher().establishBaseline({
		seed: await seed(store.store),
		branch: "b",
	});
	if (baseline.status !== "published")
		throw new Error(JSON.stringify(baseline));
	host = context.host();
	await host.acceptCandidate(command(1, control.now));
	await host.alarm();
	await complete(storage, host, 1);
	execution.state.files = { "README.md": "after one" };
	const published = await context.publisher().publishBoundary();
	if (published.status !== "published") throw new Error("boundary");
	host = await reopen(context);
	await host.acceptCandidate(command(2, control.now));
	await host.alarm();
	await complete(storage, host, 2);
	execution.state.files = { "README.md": "after two" };
	return { host: await reopen(context), pair: published.manifest };
}

const assistantState = (context: Context, sequence: number) => {
	const intent = context.assistants.get(`assistant-${sequence}`);
	return intent
		? { status: intent.status, reason: intent.reason ?? null }
		: null;
};
const historyText = async (host: PiDurableHost) =>
	JSON.stringify((await host.history()).items);

it("restores files and the matching conversation together, keeps answered history and fails what the cutoff discarded", async () => {
	await fixture("restore-current", async (context) => {
		const { storage, control, restore } = context;
		const { host, pair } = await pairAfterFirst(context);
		// Accepted but never started before the restore: 3 and 4.
		await host.acceptCandidate(command(3, control.now));
		await host.acceptCandidate(command(4, control.now));
		const before = submissions(storage);
		restore.state.fault = "retry";
		await host.acceptCandidate(restoreCommand(5, pair.id, 2));
		expect(host.checkpointPort().epoch()).toBe(2);
		await host.alarm();
		// The completion is not acknowledged yet: ordinary work stays closed.
		await host.acceptCandidate(command(6, control.now));
		await host.alarm();
		expect(submissions(storage)).toBe(before);
		expect(restore.state.completions).toHaveLength(2);
		expect(context.execution.state.files).toEqual({ "README.md": "after one" });
		expect(assistantState(context, 1)).toEqual({
			status: "complete",
			reason: null,
		});
		expect(assistantState(context, 2)).toEqual({
			status: "complete",
			reason: null,
		});
		for (const sequence of [3, 4])
			expect(assistantState(context, sequence)).toEqual({
				status: "failed",
				reason: "checkpoint_restored",
			});
		const history = await historyText(host);
		expect(history).toContain("Private instruction 1");
		expect(history).not.toContain("Private instruction 2");

		restore.state.fault = undefined;
		await host.alarm();
		expect(restore.state.completions.at(-1)).toEqual({
			version: 1,
			restoreCommandId: "restore-5",
			pairId: pair.id,
			restoredPairId: pair.id,
			fallback: false,
			cutoffSeq: 4,
			conversationGeneration: 2,
		});
		await complete(storage, host, 6);
		const after = await historyText(host);
		expect(after).toContain("Private instruction 6");
		expect(after).not.toContain("Private instruction 2");
		// Late redelivery of a discarded command returns its recorded fate.
		await host.acceptCandidate(command(3, control.now));
		await host.alarm();
		expect(assistantState(context, 3)).toEqual({
			status: "failed",
			reason: "checkpoint_restored",
		});
		expect(submissions(storage)).toBe(before + 1);
		// The old generation keeps its later history inspectable.
		expect(
			storage.sql
				.exec(
					"SELECT generation, pair, restore FROM host_generations ORDER BY generation",
				)
				.toArray()
				.map((row) => ({ ...row })),
		).toEqual([
			{ generation: 1, pair: null, restore: null },
			{ generation: 2, pair: pair.id, restore: "restore-5" },
		]);
	});
});

it("waits for an in-flight provider request, and an unknown outcome blocks the restore without any fallback", async () => {
	await fixture("restore-unknown", async (context) => {
		const { storage, control, restore, execution } = context;
		const { pair } = await pairAfterFirst(context);
		const host = context.host();
		const model = context.model();
		model.phase = "request";
		await host.acceptCandidate(command(3, control.now));
		await host.alarm();
		await model.entered.promise;
		await host.acceptCandidate(command(4, control.now));
		const calls = control.calls();
		await host.acceptCandidate(restoreCommand(5, pair.id, 2));
		await host.alarm();
		// Old work is retired, but the provider request's outcome is still open.
		expect(
			storage.sql.exec("SELECT state FROM host_restores").one().state,
		).toBe("retired");
		for (const sequence of [3, 4])
			expect(assistantState(context, sequence)).toEqual({
				status: "failed",
				reason: "checkpoint_restored",
			});
		expect(execution.state.files).toEqual({ "README.md": "after two" });
		const deadline = Number(
			storage.sql
				.exec(
					"SELECT max(operation_deadline) AS d FROM host_effects WHERE state = 'admitted'",
				)
				.one().d,
		);
		control.now = deadline + 1;
		await host.alarm();
		await host.alarm();
		expect(PiDurableHost.observe(storage).snapshot?.health).toMatchObject({
			safetyStopped: true,
		});
		expect(
			storage.sql.exec("SELECT state FROM host_restores").one().state,
		).toBe("retired");
		expect(restore.state.completions).toEqual([]);
		expect(execution.state.files).toEqual({ "README.md": "after two" });
		expect(
			execution.state.calls.some((call) => call.method === "extract"),
		).toBe(true); // the baseline seed, before the restore
		expect(
			execution.state.calls.filter((call) => call.method === "extract"),
		).toHaveLength(1);
		expect(control.calls()).toBe(calls);
	});
});

it("records a result that arrives after the fence under its original epoch, then restores without running anything new", async () => {
	await fixture("restore-late-result", async (context) => {
		const { storage, control, restore } = context;
		const { pair } = await pairAfterFirst(context);
		const host = context.host();
		const model = context.model();
		model.phase = "request";
		await host.acceptCandidate(command(3, control.now));
		await host.alarm();
		await model.entered.promise;
		const calls = control.calls();
		await host.acceptCandidate(restoreCommand(4, pair.id, 2));
		model.remote.resolve();
		await expect
			.poll(
				() =>
					storage.sql
						.exec(
							"SELECT count(*) AS n FROM host_effects WHERE state = 'admitted'",
						)
						.one().n,
			)
			.toBe(0);
		await host.alarm();
		expect(restore.state.completions).toHaveLength(1);
		expect(control.calls()).toBe(calls);
		// The late provider result settled under the epoch that admitted it.
		expect(
			storage.sql
				.exec("SELECT DISTINCT epoch FROM host_effects")
				.toArray()
				.map((row) => row.epoch),
		).toEqual([1]);
		expect(
			storage.sql
				.exec(
					"SELECT epoch FROM recovery_scopes WHERE purpose = 'restore' ORDER BY rowid DESC LIMIT 1",
				)
				.one().epoch,
		).toBe(2);
		// Its continuation was refused, so the interrupted command takes the restore fate.
		expect(assistantState(context, 3)).toEqual({
			status: "failed",
			reason: "checkpoint_restored",
		});
		expect(await historyText(host)).not.toContain("Private instruction 3");
	});
});

/** Pair 1 after command 1, pair 2 after command 2; the workspace then moves on. */
async function twoPairs(context: Context) {
	const { pair: first } = await pairAfterFirst(context);
	const second = await context.publisher().publishBoundary();
	if (second.status !== "published") throw new Error("second pair");
	context.execution.state.files = { "README.md": "after pair two" };
	return { first, second: second.manifest };
}
const tamper = (context: Context, key: string) =>
	context.store.state.objects.set(key, encoder.encode("tampered"));
const restoreState = (storage: DurableObjectStorage) =>
	storage.sql
		.exec<{ state: string; evidence: string | null }>(
			"SELECT state, evidence FROM host_restores",
		)
		.one();

it("falls back to the previous pair with that pair's own conversation position when the named pair is corrupt", async () => {
	await fixture("restore-fallback", async (context) => {
		const { storage, restore, execution } = context;
		const { first, second } = await twoPairs(context);
		tamper(context, second.context.objectKey);
		const host = context.host();
		await host.acceptCandidate(restoreCommand(3, second.id, 3));
		await host.alarm();
		expect(restore.state.completions).toEqual([
			{
				version: 1,
				restoreCommandId: "restore-3",
				pairId: second.id,
				restoredPairId: first.id,
				fallback: true,
				cutoffSeq: 2,
				conversationGeneration: 2,
			},
		]);
		expect(execution.state.files).toEqual({ "README.md": "after one" });
		const history = await historyText(host);
		expect(history).toContain("Private instruction 1");
		expect(history).not.toContain("Private instruction 2");
		expect(restoreState(storage).state).toBe("complete");
	});
});

it("moves the pointer to the restored pair, so a discarded pair is never restored or retained again", async () => {
	await fixture("restore-lineage", async (context) => {
		const { storage, control, restore, execution, product } = context;
		const { first, second } = await twoPairs(context);
		tamper(context, second.context.objectKey);
		let host = context.host();
		await host.acceptCandidate(restoreCommand(3, second.id, 3));
		// Admission stays closed until the product holds the restored pointer.
		product.state.fault = "retry";
		await host.alarm();
		expect(restoreState(storage).state).toBe("restored");
		expect(restore.state.completions).toEqual([]);
		product.state.fault = undefined;
		await host.alarm();
		expect(restoreState(storage).state).toBe("complete");
		// The restored pair is current; the discarded timeline has no retained pair.
		expect(pointer(storage)).toEqual({
			current: first.id,
			previous: null,
			mutation_generation: 4,
		});
		expect(product.state.pointer).toEqual({
			current: first.id,
			previous: null,
			generation: 4,
		});
		host = await reopen(context);
		await host.acceptCandidate(command(4, control.now));
		await host.alarm();
		await complete(storage, host, 4);
		execution.state.files = { "README.md": "after four" };
		const third = await context.publisher().publishBoundary();
		if (third.status !== "published") throw new Error("third pair");
		expect(pointer(storage)).toMatchObject({
			current: third.manifest.id,
			previous: first.id,
		});
		tamper(context, third.manifest.context.objectKey);
		host = await reopen(context);
		await host.acceptCandidate(restoreCommand(5, third.manifest.id, 5));
		await host.alarm();
		expect(restore.state.completions.at(-1)).toMatchObject({
			restoreCommandId: "restore-5",
			restoredPairId: first.id,
			fallback: true,
		});
		expect(execution.state.files).toEqual({ "README.md": "after one" });
		expect(await historyText(host)).not.toContain("Private instruction 2");
		// Naming the discarded pair is refused before the fence: nothing is discarded.
		host = await reopen(context);
		const epoch = storage.sql.exec("SELECT epoch FROM host_meta").one().epoch;
		await host.acceptCandidate(restoreCommand(6, second.id, 6));
		await host.alarm();
		expect(
			storage.sql
				.exec("SELECT state FROM host_restores WHERE command = 'restore-6'")
				.one().state,
		).toBe("refused");
		expect(restore.state.refusals).toEqual([
			{
				version: 1,
				restoreCommandId: "restore-6",
				pairId: second.id,
				cutoffSeq: 5,
				refused: "stale",
			},
		]);
		expect(storage.sql.exec("SELECT epoch FROM host_meta").one().epoch).toBe(
			epoch,
		);
		host = await reopen(context);
		await host.acceptCandidate(command(7, control.now));
		await host.alarm();
		await complete(storage, host, 7);
		expect(execution.state.files).toEqual({ "README.md": "after one" });
	});
});

it("delivers a restore pointer move that follows an undelivered publication as its own batch", async () => {
	await fixture("restore-lagging-pointer", async (context) => {
		const { storage, product, restore } = context;
		const { pair: first } = await pairAfterFirst(context);
		// The product falls behind the second publication.
		product.state.fault = "retry";
		const second = await context.publisher().publishBoundary();
		if (second.status !== "published") throw new Error("second pair");
		tamper(context, second.manifest.context.objectKey);
		const host = context.host();
		await host.acceptCandidate(restoreCommand(3, second.manifest.id, 3));
		await host.alarm();
		expect(restoreState(storage).state).toBe("restored");
		product.state.fault = undefined;
		product.state.batches.length = 0;
		await host.alarm();
		expect(restoreState(storage).state).toBe("complete");
		expect(
			product.state.batches.map((batch) =>
				batch.map((move) => move.currentPairId),
			),
		).toEqual([[second.manifest.id], [first.id]]);
		expect(product.state.pointer).toEqual({
			current: first.id,
			previous: null,
			generation: 4,
		});
		expect(restore.state.completions).toHaveLength(1);
	});
});

it("refuses a restore before the fence when the composition cannot finish one", async () => {
	await fixture("restore-unavailable", async (context) => {
		const { storage } = context;
		const { pair, host } = await pairAfterFirst(context);
		context.restoreOptions.unavailable = true;
		const epoch = storage.sql.exec("SELECT epoch FROM host_meta").one().epoch;
		await expect(
			host.acceptCandidate(restoreCommand(3, pair.id, 2)),
		).rejects.toThrow(/paired checkpoints/);
		expect(storage.sql.exec("SELECT * FROM host_restores").toArray()).toEqual(
			[],
		);
		expect(storage.sql.exec("SELECT epoch FROM host_meta").one().epoch).toBe(
			epoch,
		);
	});
});

it("blocks with evidence when both pairs are unusable, and never falls back to the seed", async () => {
	await fixture("restore-blocked", async (context) => {
		const { storage, control, restore, execution } = context;
		const { first, second } = await twoPairs(context);
		tamper(context, second.context.objectKey);
		tamper(context, first.archive.objectKey);
		const host = context.host();
		await host.acceptCandidate(restoreCommand(3, second.id, 3));
		await host.alarm();
		const blocked = restoreState(storage);
		expect(blocked.state).toBe("blocked");
		expect(JSON.parse(String(blocked.evidence))).toEqual([
			{ pair: second.id, reason: "context_failed", workspace: "unchanged" },
			{ pair: first.id, reason: "integrity_failed", workspace: "unchanged" },
		]);
		expect(restore.state.completions).toEqual([]);
		expect(execution.state.files).toEqual({ "README.md": "after pair two" });
		// Only the baseline ever extracted the seed.
		expect(
			execution.state.calls.filter((call) => call.method === "extract"),
		).toHaveLength(1);
		expect(
			PiDurableHost.observe(storage).snapshot?.health.recovery?.status,
		).toBe("blocked");
		const before = submissions(storage);
		await host.acceptCandidate(command(4, control.now));
		await host.alarm();
		await host.alarm();
		expect(submissions(storage)).toBe(before);
		expect(restoreState(storage).state).toBe("blocked");
	});
});

it("waits for a delayed predecessor and gives it the restore fate instead of a Pi submission", async () => {
	await fixture("restore-predecessor", async (context) => {
		const { storage, control, restore } = context;
		const { pair } = await pairAfterFirst(context);
		const host = context.host();
		const before = submissions(storage);
		// Command 3 was accepted before the restore, but its delivery is late.
		await host.acceptCandidate(restoreCommand(4, pair.id, 2));
		await host.alarm();
		expect(restoreState(storage).state).toBe("fenced");
		// A publication cannot move the pointer the fenced restore named.
		expect(await context.publisher().publishBoundary()).toEqual({
			status: "deferred",
			reason: "restore_pending",
		});
		expect(restore.state.completions).toEqual([]);
		await host.acceptCandidate(command(3, control.now));
		await host.alarm();
		expect(restoreState(storage).state).toBe("complete");
		expect(restore.state.completions).toHaveLength(1);
		expect(submissions(storage)).toBe(before);
		expect(assistantState(context, 3)).toEqual({
			status: "failed",
			reason: "checkpoint_restored",
		});
	});
});

it.each([
	"after-fence",
	"between-dispositions",
	"after-files",
	"after-generation",
	"lost-acknowledgment",
] as const)("a process lost %s resumes the restore once, with no stranded or replayed instruction", async (point) => {
	await fixture(`restore-crash-${point}`, async (context) => {
		const { storage, control, restore, execution } = context;
		const { pair } = await pairAfterFirst(context);
		let host = context.host();
		await host.acceptCandidate(command(3, control.now));
		await host.acceptCandidate(command(4, control.now));
		const before = {
			submissions: submissions(storage),
			calls: control.calls(),
		};
		await host.acceptCandidate(restoreCommand(5, pair.id, 2));
		if (point === "between-dispositions") {
			let thrown = false;
			context.hostFault.at = (at) => {
				if (at !== "restore-disposition" || thrown) return;
				thrown = true;
				throw new Error("Process lost");
			};
			await host.alarm();
			context.hostFault.at = undefined;
			expect(thrown).toBe(true);
			expect(restoreState(storage).state).toBe("fenced");
		}
		if (point === "after-files") {
			let reached!: () => void;
			const lost = new Promise<void>((resolve) => {
				reached = resolve;
			});
			context.restoreOptions.fault = (at) => {
				if (at !== "after-restore-files") return;
				reached();
				return new Promise<void>(() => undefined);
			};
			void host.alarm();
			await lost;
			context.restoreOptions.fault = undefined;
			expect(restoreState(storage).state).toBe("retired");
			expect(execution.state.files).toEqual({ "README.md": "after one" });
		}
		if (point === "after-generation") {
			restore.state.fault = "throw";
			await host.alarm();
			restore.state.fault = undefined;
			expect(restoreState(storage).state).toBe("restored");
		}
		if (point === "lost-acknowledgment") {
			restore.state.fault = "lose-ack";
			await host.alarm();
			restore.state.fault = undefined;
			expect(restoreState(storage).state).toBe("restored");
		}
		// The lost host never runs again; the next activation opens a new one.
		if (point !== "after-files") {
			await host.yield();
			await host.awaitClosure();
		}
		host = await context.open();
		await host.alarm();
		expect(restoreState(storage).state).toBe("complete");
		expect(restore.state.applied.size).toBe(1);
		expect(restore.state.completions.at(-1)).toMatchObject({
			restoredPairId: pair.id,
			conversationGeneration: 2,
		});
		expect(
			storage.sql.exec("SELECT count(*) AS n FROM host_generations").one().n,
		).toBe(2);
		for (const sequence of [3, 4])
			expect(assistantState(context, sequence)).toEqual({
				status: "failed",
				reason: "checkpoint_restored",
			});
		expect(submissions(storage)).toBe(before.submissions);
		// Only the next ordinary command reaches the provider, from the restored context.
		await host.acceptCandidate(command(6, control.now));
		await host.alarm();
		await complete(storage, host, 6);
		expect(control.calls()).toBe(before.calls + 1);
		const history = await historyText(host);
		expect(history).toContain("Private instruction 6");
		expect(history).not.toContain("Private instruction 2");
		expect(execution.state.files).toEqual({ "README.md": "after one" });
	});
});

it("keeps a command accepted after the restore queued for the restored generation", async () => {
	await fixture("restore-after-cutoff", async (context) => {
		const { storage, control } = context;
		const { pair } = await pairAfterFirst(context);
		let host = context.host();
		await host.acceptCandidate(restoreCommand(3, pair.id, 2));
		await host.yield();
		await host.awaitClosure();
		host = await context.open();
		// Product admission reopened after the restore and this command arrived first.
		await host.acceptCandidate(command(4, control.now));
		await host.alarm();
		expect(restoreState(storage).state).toBe("complete");
		await complete(storage, host, 4);
		const history = await historyText(host);
		expect(history).toContain("Private instruction 4");
		expect(history).not.toContain("Private instruction 2");
	});
});
