import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { type ArtifactStore, r2ArtifactStore } from "./pi-durable-artifacts.ts";
import {
	command,
	complete,
	fixture,
	manifests,
	pointer,
	position,
	seed,
	submissions,
} from "./pi-durable-checkpoint.fixture.ts";
import {
	type CheckpointFault,
	type CheckpointManifestV1,
	checkpointAdmission,
	type createCheckpointPublisher,
} from "./pi-durable-checkpoints.ts";
import { PiDurableHost } from "./pi-durable-host.ts";
import {
	collect,
	fakeBranch,
	OTHER_HEAD,
	sha256,
	streamOf,
} from "./pi-durable-recovery.fixture.ts";

/** The pair's stored archive and context both match the manifest. */
async function assertPair(
	manifest: CheckpointManifestV1,
	store: ArtifactStore,
	publisher: ReturnType<typeof createCheckpointPublisher>,
) {
	const archive = await store.get(manifest.archive.objectKey);
	expect(archive).not.toBeNull();
	const bytes = await collect(archive!.body);
	expect(await sha256(bytes)).toBe(manifest.archive.digest);
	expect(bytes.byteLength).toBe(manifest.archive.byteCount);
	const context = await publisher.verifyContext(manifest);
	expect(context.position).toEqual(manifest.context.position);
	expect(manifest.archive.objectKey).toContain(`/${manifest.scope}/`);
}

it("keeps ordinary work queued until the baseline, then publishes a verified pair after seed restore and branch sync", async () => {
	await fixture("checkpoint-baseline", async (context) => {
		const { storage, control, execution, product } = context;
		const r2 = r2ArtifactStore(env.RECOVERY_ARTIFACTS);
		let host = await context.open();
		await host.acceptCandidate(command(1, control.now));
		await host.alarm();
		await host.alarm();
		expect(submissions(storage)).toBe(0);
		expect(control.calls()).toBe(0);
		expect(PiDurableHost.observe(storage).snapshot?.health.recovery).toEqual({
			status: "none",
			pairs: 0,
			projectionLag: 0,
		});

		const branch = fakeBranch();
		const publisher = context.publisher({ store: r2, branch: branch.branch });
		const result = await publisher.establishBaseline({
			seed: await seed(r2),
			branch: "ditto/workspace",
		});
		if (result.status !== "published") throw new Error(JSON.stringify(result));
		const manifest = result.manifest;
		expect(manifest).toMatchObject({
			kind: "baseline",
			sequence: 1,
			mutationGeneration: 1,
			workspaceSessionId: "workspace",
			baseline: { branchHead: OTHER_HEAD },
			effects: { outstanding: 0, disposition: "settled" },
			executor: { generation: 1, executor: 1 },
			context: { conversationGeneration: 1 },
		});
		expect(manifest.archive.sourceCommit).toBe(OTHER_HEAD);
		expect(manifest.context.position.commitSeq).toBe(position(storage));
		expect(execution.state.calls.map((call) => call.method)).toEqual([
			"writeArchive",
			"extract",
			"inspect",
			"fetchBranch",
			"inspect",
			"pack",
			"readArchive",
			"discardArchive",
		]);
		expect(execution.state.files).toEqual({ "README.md": "seed" });
		expect(branch.state.closed).toHaveLength(1);
		expect(pointer(storage)).toEqual({
			current: manifest.id,
			previous: null,
			mutation_generation: 1,
		});
		await assertPair(manifest, r2, publisher);
		// The context object is ciphertext: no Pi row text or storage names leak.
		const stored = await r2.get(manifest.context.objectKey);
		const text = new TextDecoder().decode(await collect(stored!.body));
		expect(text).not.toContain("durable_metadata");
		expect(text).toContain("aes-256-gcm");
		expect(PiDurableHost.observe(storage).snapshot?.health.recovery).toEqual({
			status: "healthy",
			pairs: 1,
			projectionLag: 1,
		});

		await host.alarm();
		await expect.poll(() => control.calls()).toBe(1);
		await complete(storage, host, 1);
		expect(product.state.pointer).toEqual({
			current: manifest.id,
			previous: null,
			generation: 1,
		});
		expect(PiDurableHost.observe(storage).snapshot?.health.recovery).toEqual({
			status: "healthy",
			pairs: 1,
			projectionLag: 0,
		});
		// Restart keeps the gate open only because the baseline is committed.
		await host.yield();
		await host.awaitClosure();
		host = await context.open();
		expect(
			await publisher.establishBaseline({
				seed: await seed(r2),
				branch: "ditto/workspace",
			}),
		).toEqual({ status: "deferred", reason: "baseline_exists" });
	});
});

it("publishes no baseline when the seed or branch authority fails, and ordinary work stays denied", async () => {
	await fixture("checkpoint-baseline-denied", async (context) => {
		const { storage, control, store } = context;
		const host = await context.open();
		await host.acceptCandidate(command(1, control.now));
		const denied = fakeBranch("deny");
		const result = await context
			.publisher({ branch: denied.branch })
			.establishBaseline({ seed: await seed(store.store), branch: "b" });
		expect(result).toEqual({
			status: "failed",
			reason: "authority_denied",
			workspace: "unusable",
		});
		const missing = await seed(store.store);
		store.state.objects.delete(missing.objectKey);
		expect(
			await context
				.publisher()
				.establishBaseline({ seed: missing, branch: "b" }),
		).toEqual({
			status: "failed",
			reason: "artifact_missing",
			workspace: "unchanged",
		});
		expect(pointer(storage).current).toBeNull();
		expect(manifests(storage)).toBe(0);
		await host.alarm();
		expect(submissions(storage)).toBe(0);
		expect(control.calls()).toBe(0);
		expect(
			PiDurableHost.observe(storage).snapshot?.health.recovery?.status,
		).toBe("degraded");
		expect(await context.publisher().publishBoundary()).toEqual({
			status: "deferred",
			reason: "baseline_missing",
		});
	});
});

it("keeps the current and previous pairs, advances one generation per publication and never rewrites a manifest", async () => {
	await fixture("checkpoint-boundaries", async (context) => {
		const { storage, control, store, product } = context;
		const host = await context.open();
		const publisher = context.publisher();
		const baseline = await publisher.establishBaseline({
			seed: await seed(store.store),
			branch: "b",
		});
		if (baseline.status !== "published") throw new Error("no baseline");
		await host.acceptCandidate(command(1, control.now));
		await host.alarm();
		await expect.poll(() => control.calls()).toBe(1);
		await complete(storage, host, 1);
		context.execution.state.files = { "README.md": "edited" };
		const second = await publisher.publishBoundary();
		if (second.status !== "published") throw new Error(JSON.stringify(second));
		expect(second.manifest).toMatchObject({
			kind: "boundary",
			sequence: 2,
			mutationGeneration: 2,
			baseline: null,
		});
		expect(second.manifest.context.position.commitSeq).toBeGreaterThan(
			baseline.manifest.context.position.commitSeq,
		);
		const third = await publisher.publishBoundary();
		if (third.status !== "published") throw new Error("third");
		expect(pointer(storage)).toEqual({
			current: third.manifest.id,
			previous: second.manifest.id,
			mutation_generation: 3,
		});
		expect(publisher.current()).toEqual({
			current: third.manifest,
			previous: second.manifest,
		});
		for (const manifest of [second.manifest, third.manifest])
			await assertPair(manifest, store.store, publisher);
		expect(() =>
			storage.sql.exec(
				"UPDATE checkpoint_manifests SET manifest = '{}' WHERE id = ?",
				third.manifest.id,
			),
		).toThrow(/immutable/);
		for (const pair of [second.manifest.id, third.manifest.id])
			expect(() =>
				storage.sql.exec("DELETE FROM checkpoint_manifests WHERE id = ?", pair),
			).toThrow(/retained/);
		// Retained objects survive cleanup even when wrongly marked orphaned.
		publisher.ledger.orphan(third.manifest.archive.objectKey);
		storage.sql.exec(
			"UPDATE checkpoint_objects SET state = 'orphaned' WHERE key = ?",
			second.manifest.context.objectKey,
		);
		await publisher.cleanup();
		for (const manifest of [second.manifest, third.manifest])
			await assertPair(manifest, store.store, publisher);
		await host.alarm();
		expect(product.state.pointer).toEqual({
			current: third.manifest.id,
			previous: second.manifest.id,
			generation: 3,
		});
		expect(
			product.state.batches.flat().map((p) => p.expectedMutationGeneration),
		).toEqual([0, 1, 2]);
	});
});

it("holds exclusive ownership: a concurrent publication and ordinary work wait until the scope is released", async () => {
	await fixture("checkpoint-exclusive", async (context) => {
		const { storage, control, store, execution } = context;
		const host = await context.open();
		const publisher = context.publisher();
		await publisher.establishBaseline({
			seed: await seed(store.store),
			branch: "b",
		});
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let entered!: () => void;
		const packing = new Promise<void>((resolve) => {
			entered = resolve;
		});
		execution.state.faults.pack = async () => {
			entered();
			await gate;
		};
		const running = publisher.publishBoundary();
		await packing;
		expect(await context.publisher().publishBoundary()).toEqual({
			status: "deferred",
			reason: "scope_denied",
		});
		await host.acceptCandidate(command(1, control.now));
		await host.alarm();
		expect(submissions(storage)).toBe(0);
		expect(control.calls()).toBe(0);
		release();
		expect((await running).status).toBe("published");
		// Releasing the scope rearms the deferred work and the pointer move.
		expect(await storage.getAlarm()).not.toBeNull();
		expect(
			storage.sql
				.exec(
					"SELECT id FROM host_wakeups WHERE id IN ('product','checkpoint') ORDER BY id",
				)
				.toArray()
				.map((row) => row.id),
		).toEqual(["checkpoint", "product"]);
		await host.alarm();
		await expect.poll(() => control.calls()).toBe(1);
		await complete(storage, host, 1);
		expect(context.product.state.pointer.generation).toBe(2);
	});
});

it("defers publication while a run is being scheduled, then the run completes", async () => {
	await fixture("checkpoint-scheduling", async (context) => {
		const { storage, control, store } = context;
		const host = await context.open();
		await context.publisher().establishBaseline({
			seed: await seed(store.store),
			branch: "b",
		});
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let entered!: () => void;
		const configuring = new Promise<void>((resolve) => {
			entered = resolve;
		});
		context.configurationGate.wait = async () => {
			entered();
			await gate;
		};
		await host.acceptCandidate(command(1, control.now));
		const alarm = host.alarm();
		await configuring;
		expect(
			storage.sql.exec("SELECT state FROM host_runs WHERE id='command-1'").one()
				.state,
		).toBe("queued");
		expect(await context.publisher().publishBoundary()).toEqual({
			status: "deferred",
			reason: "scope_denied",
		});
		context.configurationGate.wait = undefined;
		release();
		await alarm;
		await expect.poll(() => control.calls()).toBe(1);
		await complete(storage, host, 1);
		expect((await context.publisher().publishBoundary()).status).toBe(
			"published",
		);
	});
});

it("refuses publication when authority, epoch or effects change after upload, and cleans both prepared objects", async () => {
	await fixture("checkpoint-stale", async (context) => {
		const { storage, store, authority } = context;
		const host = await context.open();
		const baseline = await context.publisher().establishBaseline({
			seed: await seed(store.store),
			branch: "b",
		});
		if (baseline.status !== "published") throw new Error("no baseline");
		const changes: [string, () => void, () => void][] = [
			[
				"executor generation",
				() => {
					authority.generation = 2;
				},
				() => {
					authority.generation = 1;
				},
			],
			[
				"epoch",
				() => storage.sql.exec("UPDATE host_meta SET epoch = epoch + 1"),
				() => undefined,
			],
			[
				"Pi commit position",
				() =>
					storage.sql.exec(
						"UPDATE durable_metadata SET next_seq = next_seq + 1",
					),
				() =>
					storage.sql.exec(
						"UPDATE durable_metadata SET next_seq = next_seq - 1",
					),
			],
			[
				"effect admission",
				() =>
					storage.sql.exec(
						"INSERT INTO host_effects (id, kind, invocation, epoch, attempt, executor, deadline, state) VALUES ('late', 'tool', 'x', 1, 1, 1, 0, 'pi-committed')",
					),
				() => undefined,
			],
		];
		for (const [label, change, restore] of changes) {
			const objects = store.state.objects.size;
			const result = await context
				.publisher({
					fault: (point) => {
						if (point === "after-verify") change();
					},
				})
				.publishBoundary();
			expect(result, label).toEqual({
				status: "failed",
				reason: "stale",
				workspace: "unchanged",
			});
			expect(store.state.objects.size, label).toBe(objects + 2);
			expect(pointer(storage).current, label).toBe(baseline.manifest.id);
			expect((await context.publisher().cleanup()).cleaned, label).toBe(2);
			expect(store.state.objects.size, label).toBe(objects);
			restore();
		}
		expect(manifests(storage)).toBe(1);
		expect(host.checkpointPort().blocked()).toBe(false);
	});
});

it("defers publication while writers are unsettled, the executor is not exclusive or a recovery outcome is unknown", async () => {
	await fixture("checkpoint-writers", async (context) => {
		const { storage, store, authority, execution } = context;
		await context.open();
		const publisher = context.publisher();
		await publisher.establishBaseline({
			seed: await seed(store.store),
			branch: "b",
		});
		const calls = execution.state.calls.length;
		expect(
			await context
				.publisher({ writers: async () => ({ settled: false }) })
				.publishBoundary(),
		).toEqual({ status: "deferred", reason: "writers_unsettled" });
		authority.liveExecutors = 2;
		expect(await publisher.publishBoundary()).toEqual({
			status: "deferred",
			reason: "executor_not_current",
		});
		authority.liveExecutors = 1;
		authority.current = false;
		expect(await publisher.publishBoundary()).toEqual({
			status: "deferred",
			reason: "executor_not_current",
		});
		authority.current = true;
		expect(execution.state.calls.length).toBe(calls);
		// A lost restore extraction leaves an unknown outcome that blocks publication.
		storage.sql.exec(
			"INSERT INTO recovery_scopes (id, purpose, epoch, generation, held) VALUES ('lost', 'restore', 1, 1, 1)",
		);
		storage.sql.exec(
			"INSERT INTO recovery_operations (id, scope, step, epoch, generation, deadline, state) VALUES ('lost-extract', 'lost', 'extract', 1, 1, 0, 'admitted')",
		);
		publisher.recover();
		expect(await publisher.publishBoundary()).toEqual({
			status: "deferred",
			reason: "scope_denied",
		});
		expect(
			PiDurableHost.observe(storage).snapshot?.health.recovery?.status,
		).toBe("blocked");
	});
});

/** Runs a publication until `point`, where the process is lost, then reopens the host. */
async function crashAt(
	context: Parameters<Parameters<typeof fixture>[1]>[0],
	point: CheckpointFault,
) {
	let reached!: () => void;
	const lost = new Promise<void>((resolve) => {
		reached = resolve;
	});
	void context
		.publisher({
			fault: (at) => {
				if (at !== point) return;
				reached();
				return new Promise<void>(() => undefined);
			},
		})
		.publishBoundary();
	await lost;
	expect(checkpointAdmission(context.storage).exclusive).toBe(true);
	await context.host().yield();
	await context.host().awaitClosure();
	return context.open();
}

it("leaves no restorable pair when the process is lost before the commit, and reopening releases ownership", async () => {
	for (const point of [
		"after-archive",
		"after-context-upload",
		"after-verify",
	] as const) {
		await fixture(`checkpoint-crash-${point}`, async (context) => {
			const { storage, store, control } = context;
			await context.open();
			const baseline = await context.publisher().establishBaseline({
				seed: await seed(store.store),
				branch: "b",
			});
			if (baseline.status !== "published") throw new Error("no baseline");
			const before = store.state.objects.size;
			const host = await crashAt(context, point);
			expect(checkpointAdmission(storage), point).toEqual({
				baseline: true,
				exclusive: false,
			});
			expect(pointer(storage), point).toEqual({
				current: baseline.manifest.id,
				previous: null,
				mutation_generation: 1,
			});
			expect(manifests(storage), point).toBe(1);
			const restarted = context.publisher();
			await restarted.cleanup();
			expect(store.state.objects.size, point).toBe(before);
			const retried = await restarted.publishBoundary();
			if (retried.status !== "published") throw new Error(point);
			expect(retried.manifest.mutationGeneration).toBe(2);
			await assertPair(retried.manifest, store.store, restarted);
			await assertPair(baseline.manifest, store.store, restarted);
			// Ordinary work resumes on its own wakeup after the reopened host.
			await host.acceptCandidate(command(1, control.now));
			expect(await storage.getAlarm()).not.toBeNull();
			await host.alarm();
			await expect.poll(() => control.calls()).toBe(1);
		});
	}
	await fixture("checkpoint-crash-commit", async (context) => {
		const { storage, store } = context;
		await context.open();
		await context.publisher().establishBaseline({
			seed: await seed(store.store),
			branch: "b",
		});
		const before = store.state.objects.size;
		await expect(
			context
				.publisher({
					fault: (at) => {
						if (at === "commit") throw new Error("Injected commit");
					},
				})
				.publishBoundary(),
		).rejects.toThrow("Injected commit");
		expect(manifests(storage)).toBe(1);
		expect(pointer(storage).mutation_generation).toBe(1);
		expect(
			storage.sql.exec("SELECT count(*) AS n FROM checkpoint_projections").one()
				.n,
		).toBe(1);
		await context.host().yield();
		await context.host().awaitClosure();
		await context.open();
		await context.publisher().cleanup();
		expect(store.state.objects.size).toBe(before);
	});
});

it("keeps a pair whole when the process is lost after its commit, and delivers its pointer move after reopening", async () => {
	await fixture("checkpoint-crash-after-commit", async (context) => {
		const { storage, store, product } = context;
		await context.open();
		await context.publisher().establishBaseline({
			seed: await seed(store.store),
			branch: "b",
		});
		await context.host().alarm();
		const host = await crashAt(context, "after-commit");
		expect(checkpointAdmission(storage).exclusive).toBe(false);
		const restarted = context.publisher();
		await restarted.cleanup();
		const committed = restarted.current().current;
		if (!committed) throw new Error("lost commit");
		expect(committed.mutationGeneration).toBe(2);
		await assertPair(committed, store.store, restarted);
		expect(
			storage.sql
				.exec("SELECT id FROM host_wakeups WHERE id = 'checkpoint'")
				.toArray(),
		).toHaveLength(1);
		expect(await storage.getAlarm()).not.toBeNull();
		await host.alarm();
		expect(product.state.pointer.current).toBe(committed.id);
		const retried = await restarted.publishBoundary();
		if (retried.status !== "published") throw new Error("retry");
		expect(pointer(storage)).toEqual({
			current: retried.manifest.id,
			previous: committed.id,
			mutation_generation: 3,
		});
		for (const manifest of [committed, retried.manifest])
			await assertPair(manifest, store.store, restarted);
		expect(
			storage.sql
				.exec(
					"SELECT expected, mutation_generation FROM checkpoint_projections ORDER BY version",
				)
				.toArray()
				.map((row) => ({ ...row })),
		).toEqual([
			{ expected: 0, mutation_generation: 1 },
			{ expected: 1, mutation_generation: 2 },
			{ expected: 2, mutation_generation: 3 },
		]);
	});
});

it("keeps a completed assistant complete when backup or product application fails, with lag and degradation visible", async () => {
	await fixture("checkpoint-degraded", async (context) => {
		const { storage, control, store, product } = context;
		const host = await context.open();
		const publisher = context.publisher();
		await publisher.establishBaseline({
			seed: await seed(store.store),
			branch: "b",
		});
		product.state.fault = "throw";
		await host.acceptCandidate(command(1, control.now));
		await host.alarm();
		await expect.poll(() => control.calls()).toBe(1);
		await complete(storage, host, 1);
		store.state.failPut = true;
		expect(await publisher.publishBoundary()).toEqual({
			status: "failed",
			reason: "store_failed",
			workspace: "unchanged",
		});
		const degraded = PiDurableHost.observe(storage).snapshot;
		expect(degraded?.assistants).toEqual([
			expect.objectContaining({ id: "assistant-1", state: "complete" }),
		]);
		expect(degraded?.health.recovery).toEqual({
			status: "degraded",
			pairs: 1,
			projectionLag: 1,
		});
		store.state.failPut = false;
		const published = await publisher.publishBoundary();
		expect(published.status).toBe("published");
		expect(PiDurableHost.observe(storage).snapshot?.health.recovery).toEqual({
			status: "healthy",
			pairs: 2,
			projectionLag: 2,
		});
		// A lost acknowledgment leaves the pair published; the retry is already applied.
		product.state.fault = "lose-ack";
		await host.alarm();
		expect(
			PiDurableHost.observe(storage).snapshot?.health.recovery?.projectionLag,
		).toBe(2);
		product.state.fault = "retry";
		await host.alarm();
		expect(
			PiDurableHost.observe(storage).snapshot?.health.recovery?.projectionLag,
		).toBe(2);
		// A later move cannot settle ahead of an earlier one that must retry.
		product.state.fault = "retry-first";
		await host.alarm();
		expect(
			PiDurableHost.observe(storage).snapshot?.health.recovery?.projectionLag,
		).toBe(2);
		product.state.fault = undefined;
		await host.alarm();
		expect(
			storage.sql
				.exec("SELECT outcome FROM checkpoint_projections ORDER BY version")
				.toArray()
				.map((row) => row.outcome),
		).toEqual(["already_applied", "already_applied"]);
		expect(PiDurableHost.observe(storage).snapshot?.health.recovery).toEqual({
			status: "healthy",
			pairs: 2,
			projectionLag: 0,
		});
		expect(
			storage.sql
				.exec("SELECT state FROM host_members WHERE assistant='assistant-1'")
				.one().state,
		).toBe("complete");
	});
});

it("rejects a context object that does not read back exactly, without publishing", async () => {
	await fixture("checkpoint-context-integrity", async (context) => {
		const { storage, store } = context;
		await context.open();
		await context.publisher().establishBaseline({
			seed: await seed(store.store),
			branch: "b",
		});
		const tampering: ArtifactStore = {
			...store.store,
			async put(key, body, length) {
				const bytes = await collect(body);
				if (key.startsWith("context/")) bytes[bytes.length - 3] ^= 1;
				await store.store.put(key, streamOf(bytes), length);
			},
		};
		expect(
			await context.publisher({ store: tampering }).publishBoundary(),
		).toEqual({
			status: "failed",
			reason: "context_failed",
			workspace: "unchanged",
		});
		expect(manifests(storage)).toBe(1);
		// The same bytes under another pair's identity fail authentication.
		const pairs = context.publisher().current();
		const forged = {
			...pairs.current!,
			id: "other-pair",
		};
		await expect(context.publisher().verifyContext(forged)).rejects.toThrow();
	});
});

it("stops delivery at a rejected pointer move and shows it as degraded lag", async () => {
	await fixture("checkpoint-rejected", async (context) => {
		const { storage, store, product } = context;
		const host = await context.open();
		const publisher = context.publisher();
		// The product's pointer is ahead of the runtime, so the first move is rejected.
		product.state.pointer.generation = 5;
		await publisher.establishBaseline({
			seed: await seed(store.store),
			branch: "b",
		});
		await host.alarm();
		expect(product.state.batches).toHaveLength(1);
		expect((await publisher.publishBoundary()).status).toBe("published");
		await host.alarm();
		expect(product.state.batches).toHaveLength(1);
		expect(PiDurableHost.observe(storage).snapshot?.health.recovery).toEqual({
			status: "degraded",
			pairs: 2,
			projectionLag: 2,
		});
		expect(
			storage.sql
				.exec("SELECT id FROM host_wakeups WHERE id = 'checkpoint'")
				.toArray(),
		).toEqual([]);
	});
});
