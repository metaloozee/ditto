import { expect, it } from "vitest";
import type { CommandV2 } from "../../../packages/runtime-contracts/src/product-command.js";
import {
	ANSWER,
	command,
	completeFirst,
	fixture,
	rows,
	stop,
	wakeup,
} from "./pi-durable-candidate.fixture.ts";

it("settles every pending assistant of a stopped multi-follow-up run with the stop reason", async () => {
	await fixture("projection-cold-stop", async (storage, open, control) => {
		const host = await open();
		for (const sequence of [1, 2, 3])
			await host.acceptCandidate(command(sequence, control.now));
		await host.acceptCandidate(stop(4, control.now), command(1, control.now));
		await host.alarm();
		expect(
			rows(
				storage,
				"SELECT assistant,state,reason,applied FROM host_projections ORDER BY assistant",
			),
		).toEqual(
			[1, 2, 3].map((n) => ({
				assistant: `assistant-${n}`,
				state: "failed",
				reason: "run_stopped",
				applied: 1,
			})),
		);
		expect(storage.sql.exec("SELECT state FROM host_runs").one().state).toBe(
			"canceled",
		);
		expect(control.calls()).toBe(0);
	});
});

it("fails late follow-ups after completion and keeps the earlier success complete", async () => {
	await fixture("projection-stop", async (storage, open, control) => {
		let host = await open();
		await host.acceptCandidate(command(1, control.now));
		await completeFirst(storage, host, control);
		await host.joinInvocation();
		host = await open();
		await host.acceptCandidate(command(2, control.now));
		await host.acceptCandidate(command(3, control.now));
		await host.acceptCandidate(stop(4, control.now), command(1, control.now));
		expect(
			rows(
				storage,
				"SELECT assistant,state,reason,version,applied FROM host_projections ORDER BY rowid",
			),
		).toEqual([
			{
				assistant: "assistant-1",
				state: "complete",
				reason: null,
				version: 1,
				applied: 1,
			},
			{
				assistant: "assistant-2",
				state: "failed",
				reason: "target_run_terminal",
				version: 1,
				applied: 0,
			},
			{
				assistant: "assistant-3",
				state: "failed",
				reason: "target_run_terminal",
				version: 1,
				applied: 0,
			},
		]);
		await host.alarm();
		expect(control.product.applied).toEqual(
			new Map([
				["assistant-1", 1],
				["assistant-2", 1],
				["assistant-3", 1],
			]),
		);
		const first = control.product.batches[0]?.[0];
		expect(first).toMatchObject({
			assistantMessageId: "assistant-1",
			commandId: "command-1",
			runId: "command-1",
			status: "complete",
			reason: null,
			content: ANSWER,
		});
		expect(
			control.product.batches
				.flat()
				.filter((intent) => intent.status === "failed")
				.every((intent) => intent.content === undefined),
		).toBe(true);
		expect(control.calls()).toBe(1);
		expect(wakeup(storage)).toBeUndefined();
	});
});

it("retains intents until an exact acknowledgment and retries from a durable wakeup without rerunning work", async () => {
	await fixture("projection-retry", async (storage, open, control) => {
		let host = await open();
		control.product.mode = "throw";
		await host.acceptCandidate(command(1, control.now));
		await completeFirst(storage, host, control);
		await host.deliverProjections(true);
		for (const mode of [
			"throw",
			"short",
			"wrong-version",
			"retry",
			"lose-ack",
		] as const) {
			control.product.mode = mode;
			await host.deliverProjections(true);
			expect(
				storage.sql.exec("SELECT applied FROM host_projections").one().applied,
			).toBe(0);
			expect(wakeup(storage)).toBe(control.now + 5000);
		}
		// The lost acknowledgment already applied; a reopened host retries the
		// same version and the product answers already_applied.
		await host.joinInvocation();
		host = await open();
		control.product.mode = "ok";
		control.now += 5000;
		await host.alarm();
		expect(
			storage.sql.exec("SELECT applied FROM host_projections").one().applied,
		).toBe(1);
		expect(wakeup(storage)).toBeUndefined();
		const versions = new Set(
			control.product.batches.flat().map((intent) => intent.projectionVersion),
		);
		expect(versions).toEqual(new Set([1]));
		expect(control.calls()).toBe(1);
		expect(rows(storage, "SELECT * FROM submissions")).toHaveLength(1);
	});
});

it("commits terminal decisions, projections and semantic events together or not at all", async () => {
	await fixture("projection-atomic", async (storage, open, control) => {
		let host = await open();
		control.product.mode = "throw";
		await host.acceptCandidate(command(1, control.now));
		await host.alarm();
		await expect.poll(() => control.calls()).toBe(1);
		const events = () =>
			Number(storage.sql.exec("SELECT count(*) AS n FROM host_events").one().n);
		const before = events();
		control.fault = "account";
		await expect(host.reconcile()).rejects.toThrow("Injected account");
		expect(rows(storage, "SELECT * FROM host_projections")).toHaveLength(0);
		expect(events()).toBe(before);
		control.fault = undefined;
		await host.yield().catch(() => undefined);
		await host.awaitClosure().catch(() => undefined);
		host = await open();
		await expect
			.poll(async () => {
				await host.reconcile();
				return rows(storage, "SELECT state FROM host_projections");
			})
			.toEqual([{ state: "complete" }]);
		expect(
			rows(
				storage,
				"SELECT kind,target,state FROM host_events ORDER BY position",
			).slice(before),
		).toContainEqual({
			kind: "assistant",
			target: "assistant-1",
			state: "complete",
		});
		const positions = rows(
			storage,
			"SELECT position FROM host_events ORDER BY position",
		).map((row) => Number(row.position));
		expect(new Set(positions).size).toBe(positions.length);
		expect(control.calls()).toBe(1);
	});
});

it("still reconciles a retained expiry after its run becomes terminal", async () => {
	await fixture(
		"projection-expiry-terminal",
		async (storage, open, control) => {
			let host = await open();
			const input = command(1, control.now);
			await host.acceptCandidate(input);
			control.now = input.deadlineAt;
			control.loseDecision = true;
			await expect(host.alarm()).rejects.toThrow(
				"Lost decision acknowledgment",
			);
			control.loseDecision = false;
			await host.yield().catch(() => undefined);
			await host.awaitClosure().catch(() => undefined);
			host = await open();
			await host.acceptCandidate(stop(2, control.now), input);
			expect(storage.sql.exec("SELECT state FROM host_runs").one().state).toBe(
				"canceled",
			);
			await host.alarm();
			const expired = control.decisions.filter(
				(decision) => decision.decision === "expired",
			);
			expect(expired.length).toBeGreaterThanOrEqual(2);
			expect(
				new Set(expired.map((decision) => JSON.stringify(decision))).size,
			).toBe(1);
			expect(
				rows(
					storage,
					"SELECT assistant,state,reason,applied FROM host_projections",
				),
			).toEqual([
				{
					assistant: "assistant-1",
					state: "failed",
					reason: "command_expired",
					applied: 1,
				},
			]);
			expect(control.calls()).toBe(0);
		},
	);
});

it("keeps a retained expiry when a cancel for the same command arrives first", async () => {
	await fixture("projection-expiry-cancel", async (storage, open, control) => {
		let host = await open();
		const input = command(1, control.now);
		await host.acceptCandidate(input);
		control.now = input.deadlineAt;
		control.loseDecision = true;
		await expect(host.alarm()).rejects.toThrow("Lost decision acknowledgment");
		control.loseDecision = false;
		await host.yield().catch(() => undefined);
		await host.awaitClosure().catch(() => undefined);
		host = await open();
		const cancel: CommandV2 = {
			version: 2,
			kind: "cancel",
			commandId: "cancel",
			commandSeq: 2,
			userId: "owner",
			projectId: "project",
			workspaceSessionId: "workspace",
			runtimeOwnerVersion: 1,
			receiptId: "cancel-receipt",
			acceptedAt: control.now,
			deadlineAt: control.now + 900000,
			payloadDigest: "c".repeat(64),
			targetCommandId: "command-1",
		};
		await host.acceptCandidate(cancel, input);
		await host.alarm();
		const expired = control.decisions.filter(
			(decision) => decision.decision === "expired",
		);
		expect(expired.length).toBeGreaterThanOrEqual(2);
		expect(
			rows(
				storage,
				"SELECT assistant,state,reason,applied FROM host_projections",
			),
		).toEqual([
			{
				assistant: "assistant-1",
				state: "failed",
				reason: "command_expired",
				applied: 1,
			},
		]);
		expect(control.calls()).toBe(0);
	});
});
