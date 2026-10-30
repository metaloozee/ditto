import { expect, it } from "vitest";
import type { ContinuationSeedV1 } from "../../../packages/runtime-contracts/src/lifecycle.js";
import { parseCommandV2 } from "../../../packages/runtime-contracts/src/product-command.js";
import {
	command,
	complete,
	fixture,
	manifests,
	pointer,
	seed,
	submissions,
} from "./pi-durable-checkpoint.fixture.ts";
import { PiDurableHost } from "./pi-durable-host.ts";

type Context = Parameters<Parameters<typeof fixture>[1]>[0];

/** Workspace composed, a committed baseline, then command 1 completes. */
async function firstAnswer(context: Context) {
	const { storage, control, store } = context;
	context.workspaceOptions.enabled = true;
	await context.open();
	const baseline = await context.publisher().establishBaseline({
		seed: await seed(store.store),
		branch: "b",
	});
	if (baseline.status !== "published")
		throw new Error(JSON.stringify(baseline));
	context.workspace.state.committed = JSON.stringify(
		context.execution.state.files,
	);
	const host = context.host();
	await host.acceptCandidate(command(1, control.now));
	await host.alarm();
	await complete(storage, host, 1);
	return { host, baseline: baseline.manifest };
}

function archiveCommand(sequence: number) {
	return parseCommandV2({
		version: 2,
		kind: "archive_session",
		commandId: `archive-${sequence}`,
		commandSeq: sequence,
		userId: "owner",
		projectId: "project",
		workspaceSessionId: "workspace",
		runtimeOwnerVersion: 1,
		receiptId: `archive-receipt-${sequence}`,
		acceptedAt: 1,
		deadlineAt: 900001,
		payloadDigest: "a".repeat(64),
	});
}

const archiveRow = (context: Context) =>
	context.storage.sql
		.exec<{ state: string; pair: string | null; evidence: string | null }>(
			"SELECT state, pair, evidence FROM host_archives",
		)
		.toArray()[0];
const assistantState = (context: Context, sequence: number) => {
	const intent = context.assistants.get(`assistant-${sequence}`);
	return intent
		? { status: intent.status, reason: intent.reason ?? null }
		: null;
};
const previewRow = (context: Context) =>
	context.storage.sql
		.exec<{ state: string; generation: number }>(
			"SELECT state, generation FROM workspace_preview",
		)
		.one();
const binding = (context: Context) => ({
	ownerId: "owner",
	workspaceSessionId: "workspace",
	keyring: context.keyring,
});

it("archives at the cutoff: unstarted work fails, preview stops with evidence, the final pair holds every change, and only the exact acknowledgment completes it", async () => {
	await fixture("archive-final", async (context) => {
		const { storage, control, execution, workspace, archive } = context;
		const { host } = await firstAnswer(context);
		expect(
			await host.workspaceAction({ version: 1, kind: "preview_start" }),
		).toEqual({
			status: "preview_running",
			generation: 1,
			url: expect.any(String),
		});
		expect(host.previewAuthority(1)).toBe(true);
		// An unbacked UI edit and two accepted commands that never started.
		execution.state.files = { "README.md": "edited before archive" };
		context.controller().noteMutation();
		await host.acceptCandidate(command(2, control.now));
		await host.acceptCandidate(command(3, control.now));
		const before = submissions(storage);
		const pairs = manifests(storage);
		archive.state.fault = "retry";
		await host.acceptCandidate(archiveCommand(4));
		// The fence advances the epoch before any archive work.
		expect(host.checkpointPort().epoch()).toBe(2);
		expect(host.previewAuthority(1)).toBe(false);
		expect(
			await host.workspaceAction({ version: 1, kind: "git_status" }),
		).toEqual({ status: "denied", reason: "archived" });
		await host.alarm();
		expect(submissions(storage)).toBe(before);
		expect(assistantState(context, 1)).toEqual({
			status: "complete",
			reason: null,
		});
		for (const sequence of [2, 3])
			expect(assistantState(context, sequence)).toEqual({
				status: "failed",
				reason: "session_archived",
			});
		expect(workspace.state.calls).toContain("previewStop");
		expect(previewRow(context).state).toBe("stopped");
		// The final pair holds the unbacked edit.
		expect(manifests(storage)).toBe(pairs + 1);
		const final = pointer(storage).current;
		expect(archiveRow(context)).toMatchObject({ state: "final", pair: final });
		expect(archive.state.completions.at(-1)).toEqual({
			version: 1,
			archiveCommandId: "archive-4",
			cutoffSeq: 3,
			finalPairId: final,
			mutationGeneration: pointer(storage).mutation_generation,
			conversationGeneration: 1,
		});
		expect(context.product.state.pointer.current).toBe(final);
		// No continuation is offered before the product acknowledges.
		expect(
			await PiDurableHost.continuationSeed(storage, binding(context)),
		).toBeNull();

		archive.state.fault = undefined;
		await host.alarm();
		expect(archiveRow(context).state).toBe("complete");
		const sealed = await PiDurableHost.continuationSeed(
			storage,
			binding(context),
		);
		expect(sealed).toMatchObject({
			sourceSessionId: "workspace",
			sourcePairId: final,
			selection: { model: "faux-1", thinking: "off" },
		});
		expect(JSON.stringify(sealed?.messages)).toContain("Private instruction 1");
		expect(JSON.stringify(sealed?.messages)).not.toContain(
			"Private instruction 2",
		);
		// The seal is bound to this session.
		await expect(
			PiDurableHost.continuationSeed(storage, {
				...binding(context),
				workspaceSessionId: "other",
			}),
		).rejects.toThrow();
		// Later wakeups, a reopen and workspace actions never resume work.
		const completions = archive.state.completions.length;
		const reopened = await (async () => {
			await host.yield();
			await host.awaitClosure();
			return context.open();
		})();
		await reopened.alarm();
		expect(archive.state.completions).toHaveLength(completions);
		expect(
			await reopened.workspaceAction({ version: 1, kind: "preview_start" }),
		).toEqual({ status: "denied", reason: "archived" });
		expect(submissions(storage)).toBe(before);
		// A redelivered archive keeps its recorded fate.
		await reopened.acceptCandidate(archiveCommand(4));
		expect(archiveRow(context).state).toBe("complete");
	});
});

it("reuses the current pair when nothing changed after it", async () => {
	await fixture("archive-reuse", async (context) => {
		const { storage, archive } = context;
		const { host } = await firstAnswer(context);
		const published = await context.publisher().publishBoundary();
		if (published.status !== "published") throw new Error("boundary");
		const pairs = manifests(storage);
		await host.acceptCandidate(archiveCommand(2));
		await host.alarm();
		expect(manifests(storage)).toBe(pairs);
		expect(archive.state.completions.at(-1)?.finalPairId).toBe(
			published.manifest.id,
		);
		expect(archiveRow(context).state).toBe("complete");
	});
});

it("records a product-committed completion whose acknowledgment was lost without reopening the host", async () => {
	await fixture("archive-lost-ack", async (context) => {
		const { storage, archive } = context;
		const { host } = await firstAnswer(context);
		archive.state.fault = "lost";
		await host.acceptCandidate(archiveCommand(2));
		await host.alarm();
		// The product applied the completion; the host never heard back.
		expect(archive.state.applied.size).toBe(1);
		expect(archiveRow(context).state).toBe("final");
		expect(
			await PiDurableHost.continuationSeed(storage, binding(context)),
		).toBeNull();
		PiDurableHost.acknowledgeArchive(storage);
		expect(archiveRow(context).state).toBe("complete");
		expect(
			await PiDurableHost.continuationSeed(storage, binding(context)),
		).toMatchObject({ sourcePairId: archiveRow(context).pair });
	});
});

it("never completes an unfinished or blocked archive from a passive acknowledgment", async () => {
	await fixture("archive-ack-blocked", async (context) => {
		const { workspace } = context;
		const { host } = await firstAnswer(context);
		PiDurableHost.acknowledgeArchive(context.storage);
		await host.workspaceAction({ version: 1, kind: "preview_start" });
		workspace.state.terminates = false;
		await host.acceptCandidate(archiveCommand(2));
		PiDurableHost.acknowledgeArchive(context.storage);
		expect(archiveRow(context).state).toBe("fenced");
		await host.alarm();
		await host.alarm();
		PiDurableHost.acknowledgeArchive(context.storage);
		expect(archiveRow(context).state).toBe("blocked");
	});
});

it("publishes an unbacked edit in the final pair even when the conversation did not move", async () => {
	await fixture("archive-unbacked", async (context) => {
		const { storage, archive, execution } = context;
		const { host } = await firstAnswer(context);
		const published = await context.publisher().publishBoundary();
		if (published.status !== "published") throw new Error("boundary");
		execution.state.files = { "README.md": "edited after the boundary" };
		context.controller().noteMutation();
		const pairs = manifests(storage);
		await host.acceptCandidate(archiveCommand(2));
		await host.alarm();
		expect(manifests(storage)).toBe(pairs + 1);
		expect(archive.state.completions.at(-1)?.finalPairId).not.toBe(
			published.manifest.id,
		);
		expect(archiveRow(context).state).toBe("complete");
	});
});

it("blocks with evidence when preview stop cannot prove termination, and never reports completion", async () => {
	await fixture("archive-preview-unknown", async (context) => {
		const { workspace, archive } = context;
		const { host } = await firstAnswer(context);
		await host.workspaceAction({ version: 1, kind: "preview_start" });
		workspace.state.terminates = false;
		await host.acceptCandidate(archiveCommand(2));
		// One wakeup blocks on the stop itself; a later one cannot finish it.
		await host.alarm();
		expect(archiveRow(context).state).toBe("blocked");
		await host.alarm();
		expect(archiveRow(context)).toMatchObject({
			state: "blocked",
			evidence: JSON.stringify({ reason: "preview_unknown" }),
		});
		expect(archive.state.completions).toEqual([]);
		expect(
			await host.workspaceAction({ version: 1, kind: "git_status" }),
		).toEqual({ status: "denied", reason: "archived" });
	});
});

it("refuses an archive before its fence when no workspace is composed", async () => {
	await fixture("archive-unavailable", async (context) => {
		const { storage, control } = context;
		await context.open();
		await context.publisher().establishBaseline({
			seed: await seed(context.store.store),
			branch: "b",
		});
		const host = context.host();
		await host.acceptCandidate(command(1, control.now));
		await expect(host.acceptCandidate(archiveCommand(2))).rejects.toThrow(
			"Archive requires a workspace",
		);
		expect(host.checkpointPort().epoch()).toBe(1);
		expect(archiveRow(context)).toBeUndefined();
		await host.alarm();
		await complete(storage, host, 1);
	});
});

it("continues an archived pair in a new session from the final context, with no old task, inbox or run, and a fresh recovery lineage", async () => {
	let sealed: ContinuationSeedV1 | null = null;
	let bytes: Uint8Array | undefined;
	await fixture("continue-source", async (context) => {
		const { storage, control } = context;
		const { host } = await firstAnswer(context);
		// Accepted but never run: the continuation must not resume it.
		await host.acceptCandidate(command(2, control.now));
		await host.acceptCandidate(archiveCommand(3));
		await host.alarm();
		sealed = await PiDurableHost.continuationSeed(storage, binding(context));
		bytes = context.store.state.objects.get(String(sealed?.archive.objectKey));
	});
	if (!sealed) throw new Error("No continuation seed");
	const source: ContinuationSeedV1 = sealed;
	await fixture("continue-destination", async (context) => {
		const { storage, control, store } = context;
		context.workspaceOptions.enabled = true;
		// The immutable source archive object is shared, not copied per session.
		if (!bytes) throw new Error("No source archive");
		store.state.objects.set(source.archive.objectKey, bytes);
		const host = await context.open();
		// A seed whose messages were changed is refused before anything is written.
		await expect(
			host.importContinuation({
				...source,
				messages: [...source.messages, source.messages[0]],
			}),
		).rejects.toThrow("digest");
		const ack = {
			version: 1,
			sourceSessionId: "workspace",
			sourcePairId: source.sourcePairId,
			messagesDigest: source.messagesDigest,
			messageCount: source.messages.length,
		};
		expect(await host.importContinuation(source)).toEqual(ack);
		// A lost acknowledgment repeats; another source conflicts.
		expect(await host.importContinuation(source)).toEqual(ack);
		await expect(
			host.importContinuation({ ...source, sourcePairId: "another" }),
		).rejects.toThrow("Conflicting continuation");
		const baseline = await context.publisher().establishBaseline({
			seed: source.archive,
			branch: "continued",
		});
		if (baseline.status !== "published")
			throw new Error(JSON.stringify(baseline));
		// One new initial manifest; nothing points back to the source lineage.
		expect(manifests(storage)).toBe(1);
		expect(pointer(storage)).toMatchObject({
			current: baseline.manifest.id,
			previous: null,
		});
		expect(baseline.manifest.kind).toBe("baseline");
		expect(baseline.manifest.id).not.toBe(source.sourcePairId);
		expect(
			storage.sql.exec("SELECT count(*) AS n FROM host_product_commands").one()
				.n,
		).toBe(0);
		expect(submissions(storage)).toBe(0);
		// The new session's first command runs on top of the archived context.
		await host.acceptCandidate(command(1, control.now));
		await host.alarm();
		await complete(storage, host, 1);
		const history = JSON.stringify((await host.history()).items);
		expect(history).toContain("Private instruction 1");
		expect(history).not.toContain("Private instruction 2");
		expect(submissions(storage)).toBe(1);
		// Once work exists, another source still conflicts; the separate
		// late-continuation test covers a first import after work.
		await expect(
			context.host().importContinuation({ ...source, sourcePairId: "late" }),
		).rejects.toThrow("Conflicting continuation");
	});
});

it("refuses a continuation after the session has any work", async () => {
	let sealed: ContinuationSeedV1 | null = null;
	await fixture("continue-late-source", async (context) => {
		const { host } = await firstAnswer(context);
		await host.acceptCandidate(archiveCommand(2));
		await host.alarm();
		sealed = await PiDurableHost.continuationSeed(
			context.storage,
			binding(context),
		);
	});
	if (!sealed) throw new Error("No continuation seed");
	const source: ContinuationSeedV1 = sealed;
	await fixture("continue-late-destination", async (context) => {
		const { host } = await firstAnswer(context);
		await expect(host.importContinuation(source)).rejects.toThrow(
			"A continuation must precede all work",
		);
	});
});
