import { expect, it } from "vitest";
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
import { encoder } from "./pi-durable-recovery.fixture.ts";

type Context = Parameters<Parameters<typeof fixture>[1]>[0];

const DEFERRAL = 10 * 60_000;

/** Workspace actions composed, a committed baseline, and a clean Git state. */
async function baseline(context: Context) {
	context.workspaceOptions.enabled = true;
	await context.open();
	const result = await context.publisher().establishBaseline({
		seed: await seed(context.store.store),
		branch: "b",
	});
	if (result.status !== "published") throw new Error(JSON.stringify(result));
	context.workspace.state.committed = JSON.stringify(
		context.execution.state.files,
	);
	return context.host();
}

async function reopen(context: Context) {
	await context.host().yield();
	await context.host().awaitClosure();
	return context.open();
}

const backupRow = (context: Context) =>
	context.storage.sql
		.exec<{ unbacked_since: number | null; deadline: number | null }>(
			"SELECT unbacked_since, deadline FROM workspace_backup",
		)
		.one();
const previewRow = (context: Context) =>
	context.storage.sql
		.exec<{ state: string; generation: number }>(
			"SELECT state, generation FROM workspace_preview",
		)
		.one();

it("runs UI Git under the runtime owner and publishes a pair after a quiescent commit", async () => {
	await fixture("workspace-git", async (context) => {
		const { execution, workspace, control, product } = context;
		const host = await baseline(context);
		execution.state.files = { "README.md": "edited" };
		expect(
			await host.workspaceAction({ version: 1, kind: "git_status" }),
		).toEqual({
			status: "git_status",
			branch: "b",
			head: execution.state.head,
			changed: 1,
		});
		const committed = await host.workspaceAction({
			version: 1,
			kind: "git_commit",
			message: "Edit the readme",
		});
		expect(committed).toMatchObject({ status: "committed" });
		expect(workspace.state.commits).toEqual(["Edit the readme"]);
		expect(backupRow(context)).toEqual({
			unbacked_since: control.now,
			deadline: control.now + DEFERRAL,
		});
		expect(
			await host.workspaceAction({
				version: 1,
				kind: "git_commit",
				message: "Again",
			}),
		).toMatchObject({ status: "nothing_to_commit" });
		// The commit's wakeup publishes the next pair once the host is quiescent.
		await host.alarm();
		expect(manifests(context.storage)).toBe(2);
		expect(pointer(context.storage).mutation_generation).toBe(2);
		// The pair's projection reaches the product at its own wakeup.
		await host.alarm();
		expect(product.state.pointer.generation).toBe(2);
		expect(backupRow(context).unbacked_since).toBeNull();
		// Only the owner's typed operations ran; no shell, no push.
		expect(workspace.state.calls).toEqual([
			"gitStatus",
			"gitCommit",
			"gitCommit",
		]);
	});
});

it("keeps a successful commit committed when the backup after it fails, and retries the backup", async () => {
	await fixture("workspace-backup-degraded", async (context) => {
		const { execution, store, control } = context;
		const host = await baseline(context);
		execution.state.files = { "README.md": "edited" };
		const put = store.store.put;
		store.store.put = async () => {
			throw new Error("Storage unavailable");
		};
		expect(
			await host.workspaceAction({
				version: 1,
				kind: "git_commit",
				message: "Edit",
			}),
		).toMatchObject({ status: "committed" });
		await host.alarm();
		expect(manifests(context.storage)).toBe(1);
		expect(backupRow(context).unbacked_since).toBe(control.now);
		const retry = context.storage.sql
			.exec<{ deadline: number }>(
				"SELECT deadline FROM host_wakeups WHERE id = 'workspace'",
			)
			.one().deadline;
		expect(retry).toBeGreaterThan(control.now);
		store.store.put = put;
		control.now = retry;
		await host.alarm();
		expect(manifests(context.storage)).toBe(2);
		expect(backupRow(context).unbacked_since).toBeNull();
	});
});

it("serializes UI Git with agent runs: neither starts while the other holds the workspace", async () => {
	await fixture("workspace-serial", async (context) => {
		const { storage, control, workspace } = context;
		let host = await baseline(context);
		// UI Git holds the scope: the accepted command waits.
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		workspace.state.faults.gitStatus = () => held;
		const status = host.workspaceAction({ version: 1, kind: "git_status" });
		await expect.poll(() => workspace.state.calls.length).toBe(1);
		await host.acceptCandidate(command(1, control.now));
		await host.alarm();
		expect(submissions(storage)).toBe(0);
		release();
		expect(await status).toMatchObject({ status: "git_status" });
		workspace.state.faults.gitStatus = undefined;
		host = await reopen(context);
		await host.alarm();
		await complete(storage, host, 1);
		// An active run makes UI Git wait instead of interleaving.
		host = await reopen(context);
		context.model().phase = "request";
		await host.acceptCandidate(command(2, control.now));
		await host.alarm();
		await context.model().entered.promise;
		expect(
			await host.workspaceAction({
				version: 1,
				kind: "git_commit",
				message: "Racing",
			}),
		).toEqual({ status: "denied", reason: "busy" });
		expect(workspace.state.calls).toEqual(["gitStatus"]);
		context.model().remote.resolve();
		await host.yield();
		await host.awaitClosure();
	});
});

it("keeps the first backup deadline fixed while preview defers it, then stops preview and denies new changes", async () => {
	await fixture("workspace-deferral", async (context) => {
		const { control, workspace, execution } = context;
		const host = await baseline(context);
		const started = await host.workspaceAction({
			version: 1,
			kind: "preview_start",
		});
		expect(started).toEqual({ status: "preview_running", generation: 1 });
		expect(host.previewAuthority(1)).toBe(true);
		const first = control.now;
		expect(backupRow(context).deadline).toBeNull();
		// The first change fixes the deadline; later changes and traffic never move it.
		for (const minutes of [0, 2, 5, 9]) {
			control.now = first + minutes * 60_000;
			execution.state.files = { "README.md": `edit ${minutes}` };
			host.previewTraffic();
			expect(
				await host.workspaceAction({
					version: 1,
					kind: "git_commit",
					message: `Edit ${minutes}`,
				}),
			).toMatchObject({ status: "committed" });
			await host.alarm();
			expect(backupRow(context).deadline).toBe(first + DEFERRAL);
			expect(manifests(context.storage)).toBe(1);
		}
		expect(workspace.state.preview).toBe("running");
		// At the deadline new changes are denied before the backup runs.
		control.now = first + DEFERRAL;
		execution.state.files = { "README.md": "late edit" };
		expect(
			await host.workspaceAction({
				version: 1,
				kind: "git_commit",
				message: "Late",
			}),
		).toEqual({ status: "denied", reason: "backup_overdue" });
		expect(
			await host.workspaceAction({ version: 1, kind: "git_status" }),
		).toMatchObject({ status: "git_status" });
		await host.alarm();
		// Preview stopped with evidence, which revoked generation 1's URLs, then
		// the pair published. Traffic one minute ago restarted it as generation 3.
		expect(manifests(context.storage)).toBe(2);
		expect(backupRow(context)).toEqual({
			unbacked_since: null,
			deadline: null,
		});
		expect(
			workspace.state.calls.filter((call) => call === "previewStop"),
		).toHaveLength(1);
		expect(host.previewAuthority(1)).toBe(false);
		expect(previewRow(context)).toEqual({ state: "running", generation: 3 });
		expect(host.previewAuthority(3)).toBe(true);
		expect(workspace.state.preview).toBe("running");
		expect(
			await host.workspaceAction({
				version: 1,
				kind: "git_commit",
				message: "After",
			}),
		).toMatchObject({ status: "committed" });
		// The new change starts a new deferral from now, not from the restart.
		expect(backupRow(context).deadline).toBe(control.now + DEFERRAL);
	});
});

it("restarts preview after a backup only for recent traffic or a refused start, never by itself", async () => {
	await fixture("workspace-restart", async (context) => {
		const { control, workspace, execution } = context;
		const host = await baseline(context);
		const edit = async (text: string) => {
			execution.state.files = { "README.md": text };
			expect(
				await host.workspaceAction({
					version: 1,
					kind: "git_commit",
					message: text,
				}),
			).toMatchObject({ status: "committed" });
		};
		const starts = () =>
			workspace.state.calls.filter((call) => call === "previewStart").length;
		// Starting a process is not a file change: no deadline, no backup.
		await host.workspaceAction({ version: 1, kind: "preview_start" });
		expect(backupRow(context)).toEqual({
			unbacked_since: null,
			deadline: null,
		});
		await host.workspaceAction({ version: 1, kind: "preview_stop" });
		// A user-stopped preview stays stopped; the backup publishes at once.
		await edit("one");
		await host.alarm();
		expect(manifests(context.storage)).toBe(2);
		expect(previewRow(context)).toEqual({ state: "stopped", generation: 2 });
		// No traffic during the deferral: stopped for the backup and left stopped.
		await host.workspaceAction({ version: 1, kind: "preview_start" });
		await edit("two");
		control.now += DEFERRAL;
		await host.alarm();
		expect(manifests(context.storage)).toBe(3);
		expect(previewRow(context)).toEqual({ state: "stopped", generation: 4 });
		expect(starts()).toBe(2);
		// A start refused while the backup is overdue runs once the backup commits.
		await edit("three");
		control.now += DEFERRAL;
		expect(
			await host.workspaceAction({ version: 1, kind: "preview_start" }),
		).toEqual({ status: "denied", reason: "backup_overdue" });
		expect(starts()).toBe(2);
		await host.alarm();
		expect(manifests(context.storage)).toBe(4);
		expect(previewRow(context)).toEqual({ state: "running", generation: 5 });
		// Traffic older than five minutes does not count as recent.
		await edit("four");
		host.previewTraffic();
		control.now += DEFERRAL;
		await host.alarm();
		expect(manifests(context.storage)).toBe(5);
		expect(previewRow(context).state).toBe("stopped");
		expect(starts()).toBe(3);
		// A quiet session with nothing unbacked never restarts or publishes.
		control.now += 3 * DEFERRAL;
		await host.alarm();
		expect(manifests(context.storage)).toBe(5);
		expect(starts()).toBe(3);
	});
});

it("blocks capture when preview stop cannot prove termination, across reopen", async () => {
	await fixture("workspace-stop-unknown", async (context) => {
		const { control, workspace, execution } = context;
		let host = await baseline(context);
		await host.workspaceAction({ version: 1, kind: "preview_start" });
		execution.state.files = { "README.md": "edited" };
		await host.workspaceAction({
			version: 1,
			kind: "git_commit",
			message: "Edit",
		});
		workspace.state.terminates = false;
		control.now += DEFERRAL;
		await host.alarm();
		expect(previewRow(context).state).toBe("unknown");
		expect(manifests(context.storage)).toBe(1);
		expect(
			await host.workspaceAction({ version: 1, kind: "git_status" }),
		).toEqual({ status: "denied", reason: "blocked" });
		// A lost stop is unknown too, and nothing retries it into a publication.
		host = await reopen(context);
		await host.alarm();
		expect(manifests(context.storage)).toBe(1);
		expect(await context.controller().writers()).toEqual({ settled: false });
	});
});

it("treats a lost commit as unknown and blocks every later workspace action across reopen", async () => {
	await fixture("workspace-lost-commit", async (context) => {
		const { execution, workspace } = context;
		let host = await baseline(context);
		execution.state.files = { "README.md": "edited" };
		workspace.state.faults.gitCommit = () => {
			throw new Error("Connection lost");
		};
		expect(
			await host.workspaceAction({
				version: 1,
				kind: "git_commit",
				message: "Edit",
			}),
		).toEqual({ status: "unknown" });
		workspace.state.faults.gitCommit = undefined;
		expect(
			await host.workspaceAction({ version: 1, kind: "git_status" }),
		).toEqual({ status: "denied", reason: "blocked" });
		await host.alarm();
		expect(manifests(context.storage)).toBe(1);
		host = await reopen(context);
		expect(
			await host.workspaceAction({ version: 1, kind: "git_status" }),
		).toEqual({ status: "denied", reason: "blocked" });
	});
});

it("cold preview restores committed files without Pi, and is unavailable when no pair restores", async () => {
	await fixture("workspace-cold", async (context) => {
		const { execution, workspace, storage, control, store } = context;
		const host = await baseline(context);
		const pair = pointer(storage).current;
		workspace.state.present = false;
		execution.state.files = {};
		const calls = control.calls();
		expect(
			await host.workspaceAction({ version: 1, kind: "preview_start" }),
		).toMatchObject({ status: "preview_running" });
		expect(execution.state.files).toEqual({ "README.md": "seed" });
		expect(submissions(storage)).toBe(0);
		expect(control.calls()).toBe(calls);
		expect(pointer(storage).current).toBe(pair);
		await host.workspaceAction({ version: 1, kind: "preview_stop" });
		// Corrupt the only pair: preview is unavailable and the seed is never used.
		for (const key of [...store.state.objects.keys()])
			if (key.startsWith("workspace/"))
				store.state.objects.set(key, encoder.encode("tampered"));
		execution.state.files = {};
		const extracts = execution.state.calls.filter(
			(call) => call.method === "extract",
		).length;
		expect(
			await host.workspaceAction({ version: 1, kind: "preview_start" }),
		).toEqual({ status: "preview_unavailable" });
		expect(
			execution.state.calls.filter((call) => call.method === "extract"),
		).toHaveLength(extracts);
		expect(execution.state.files).toEqual({});
		expect(previewRow(context).state).toBe("stopped");
	});
});

it("denies workspace actions during a restore and ignores a stale backup wakeup", async () => {
	await fixture("workspace-restore", async (context) => {
		const { storage, control } = context;
		const host = await baseline(context);
		// No unbacked change: a wakeup does nothing.
		context.storage.sql.exec(
			"INSERT OR REPLACE INTO host_wakeups VALUES ('workspace', ?)",
			control.now,
		);
		await host.alarm();
		expect(manifests(storage)).toBe(1);
		storage.sql.exec(
			"INSERT INTO host_restores (command, sequence, cutoff, pair, state) VALUES ('restore-1', 1, 0, 'pair', 'fenced')",
		);
		expect(
			await host.workspaceAction({ version: 1, kind: "git_status" }),
		).toEqual({ status: "denied", reason: "restore_in_progress" });
		expect(
			await host.workspaceAction({ version: 1, kind: "preview_start" }),
		).toEqual({ status: "denied", reason: "restore_in_progress" });
	});
});

it("denies agent changes once the backup is overdue without blocking the host, then admits them after the backup", async () => {
	await fixture("workspace-agent-overdue", async (context) => {
		const { storage, control, execution, store } = context;
		let host = await baseline(context);
		await host.workspaceAction({ version: 1, kind: "preview_start" });
		execution.state.files = { "README.md": "edited" };
		await host.workspaceAction({
			version: 1,
			kind: "git_commit",
			message: "Edit",
		});
		const put = store.store.put;
		store.store.put = async () => {
			throw new Error("Storage unavailable");
		};
		host = await reopen(context);
		control.now += DEFERRAL;
		const model = context.model();
		model.phase = "tool";
		await host.acceptCandidate(command(1, control.now));
		await host.alarm();
		// The backup failed, so the deadline still holds and the shell never runs.
		expect(manifests(storage)).toBe(1);
		await complete(storage, host, 1);
		expect(model.executionCalls).toBe(0);
		expect(host.checkpointPort().blocked()).toBe(false);
		host = await reopen(context);
		store.store.put = put;
		control.now = Number(
			storage.sql
				.exec("SELECT deadline FROM host_wakeups WHERE id = 'workspace'")
				.one().deadline,
		);
		await host.alarm();
		expect(manifests(storage)).toBe(2);
		expect(backupRow(context).deadline).toBeNull();
	});
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

for (const terminates of [true, false])
	it(`restore stops preview first${terminates ? " and revokes its URLs" : ", and an unproven stop blocks it before any file changes"}`, async () => {
		await fixture(
			`workspace-restore-preview-${terminates}`,
			async (context) => {
				const { storage, execution, workspace } = context;
				const host = await baseline(context);
				const seeded = execution.state.files;
				await host.workspaceAction({ version: 1, kind: "preview_start" });
				execution.state.files = { "README.md": "unbacked" };
				workspace.state.terminates = terminates;
				await host.acceptCandidate(
					restoreCommand(1, String(pointer(storage).current), 1),
				);
				await host.alarm();
				expect(host.previewAuthority(1)).toBe(false);
				const state = storage.sql
					.exec<{ state: string }>("SELECT state FROM host_restores")
					.one().state;
				if (terminates) {
					expect(previewRow(context)).toEqual({
						state: "stopped",
						generation: 2,
					});
					expect(execution.state.files).toEqual(seeded);
					expect(["restored", "complete"]).toContain(state);
					// Restore never restarts preview; the user starts it again.
					expect(
						workspace.state.calls.filter((call) => call === "previewStart"),
					).toHaveLength(1);
				} else {
					expect(previewRow(context).state).toBe("unknown");
					expect(execution.state.files).toEqual({ "README.md": "unbacked" });
					expect(["fenced", "retired"]).toContain(state);
				}
			},
		);
	});

it("denies workspace mutations without a current executor, and a generation change during setup stops the step", async () => {
	await fixture("workspace-authority", async (context) => {
		const { execution, workspace, authority } = context;
		const host = await baseline(context);
		execution.state.files = { "README.md": "edited" };
		authority.current = false;
		expect(
			await host.workspaceAction({
				version: 1,
				kind: "git_commit",
				message: "Edit",
			}),
		).toEqual({ status: "denied", reason: "busy" });
		expect(
			await host.workspaceAction({ version: 1, kind: "preview_start" }),
		).toMatchObject({ status: "denied" });
		authority.current = true;
		authority.liveExecutors = 2;
		expect(
			await host.workspaceAction({ version: 1, kind: "git_status" }),
		).toEqual({ status: "denied", reason: "busy" });
		authority.liveExecutors = 1;
		// A new executor generation between acquiring the scope and dispatch.
		const base = authority.generation;
		let reads = 0;
		Object.defineProperty(authority, "generation", {
			enumerable: true,
			get: () => (++reads >= 2 ? base + 1 : base),
		});
		expect(
			await host.workspaceAction({
				version: 1,
				kind: "git_commit",
				message: "Edit",
			}),
		).toEqual({ status: "rejected", reason: "authority_revoked" });
		expect(reads).toBe(2);
		expect(workspace.state.calls).not.toContain("gitCommit");
		expect(workspace.state.commits).toEqual([]);
	});
});

it("an agent change alone arms the backup wakeup, and the pair publishes once the run settles", async () => {
	await fixture("workspace-agent-backup", async (context) => {
		const { storage, control } = context;
		let host = await baseline(context);
		const model = context.model();
		model.phase = "tool";
		await host.acceptCandidate(command(1, control.now));
		await host.alarm();
		await model.entered.promise;
		const started = control.now;
		expect(backupRow(context)).toEqual({
			unbacked_since: started,
			deadline: started + DEFERRAL,
		});
		expect(
			storage.sql
				.exec("SELECT deadline FROM host_wakeups WHERE id = 'workspace'")
				.toArray(),
		).toHaveLength(1);
		model.remote.resolve();
		await complete(storage, host, 1);
		host = await reopen(context);
		control.now = Number(
			storage.sql
				.exec("SELECT deadline FROM host_wakeups WHERE id = 'workspace'")
				.one().deadline,
		);
		await host.alarm();
		expect(manifests(storage)).toBe(2);
		expect(backupRow(context).deadline).toBeNull();
	});
});

it("cold preview never falls back to the previous pair's files, which would not match the conversation", async () => {
	await fixture("workspace-cold-previous", async (context) => {
		const { execution, workspace, storage, store } = context;
		const host = await baseline(context);
		execution.state.files = { "README.md": "second" };
		await host.workspaceAction({
			version: 1,
			kind: "git_commit",
			message: "Second",
		});
		await host.alarm();
		expect(manifests(storage)).toBe(2);
		const { manifest } = storage.sql
			.exec<{ manifest: string }>(
				"SELECT manifest FROM checkpoint_manifests WHERE id = ?",
				pointer(storage).current,
			)
			.one();
		const key = (JSON.parse(manifest) as { archive: { objectKey: string } })
			.archive.objectKey;
		store.state.objects.set(key, encoder.encode("tampered"));
		workspace.state.present = false;
		execution.state.files = {};
		expect(
			await host.workspaceAction({ version: 1, kind: "preview_start" }),
		).toEqual({ status: "preview_unavailable" });
		expect(execution.state.files).toEqual({});
	});
});

it("two racing preview starts run one process, and preview URLs die with the host or a restore fence", async () => {
	await fixture("workspace-preview-race", async (context) => {
		const { storage, workspace } = context;
		const host = await baseline(context);
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		workspace.state.faults.present = () => held;
		const first = host.workspaceAction({ version: 1, kind: "preview_start" });
		const second = host.workspaceAction({ version: 1, kind: "preview_start" });
		release();
		const results = await Promise.all([first, second]);
		expect(
			workspace.state.calls.filter((call) => call === "previewStart"),
		).toHaveLength(1);
		expect(previewRow(context)).toEqual({ state: "running", generation: 1 });
		expect(results).toContainEqual({
			status: "preview_running",
			generation: 1,
		});
		expect(host.previewAuthority(1)).toBe(true);
		storage.sql.exec(
			"INSERT INTO host_restores (command, sequence, cutoff, pair, state) VALUES ('restore-1', 1, 0, 'pair', 'fenced')",
		);
		expect(host.previewAuthority(1)).toBe(false);
	});
});

it("a restore fenced while cold preview restores files stops the start before any process runs", async () => {
	await fixture("workspace-cold-fence", async (context) => {
		const { execution, workspace, storage } = context;
		const host = await baseline(context);
		workspace.state.present = false;
		execution.state.files = {};
		execution.state.faults.extract = () => {
			storage.sql.exec(
				"INSERT INTO host_restores (command, sequence, cutoff, pair, state) VALUES ('restore-1', 1, 0, 'pair', 'fenced')",
			);
		};
		expect(
			await host.workspaceAction({ version: 1, kind: "preview_start" }),
		).toEqual({ status: "denied", reason: "restore_in_progress" });
		expect(workspace.state.calls).not.toContain("previewStart");
		expect(previewRow(context).state).toBe("stopped");
	});
});

it("cold preview refuses to restore files while changes are unbacked, since the conversation is ahead of every pair", async () => {
	await fixture("workspace-cold-unbacked", async (context) => {
		const { execution, workspace } = context;
		const host = await baseline(context);
		execution.state.files = { "README.md": "edited" };
		await host.workspaceAction({
			version: 1,
			kind: "git_commit",
			message: "Edit",
		});
		workspace.state.present = false;
		execution.state.files = {};
		const extracts = execution.state.calls.filter(
			(call) => call.method === "extract",
		).length;
		expect(
			await host.workspaceAction({ version: 1, kind: "preview_start" }),
		).toEqual({ status: "preview_unavailable" });
		expect(
			execution.state.calls.filter((call) => call.method === "extract"),
		).toHaveLength(extracts);
		expect(execution.state.files).toEqual({});
	});
});
