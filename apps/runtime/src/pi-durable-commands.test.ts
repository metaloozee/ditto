import { expect, it } from "vitest";
import {
	type CommandV2,
	parseCommandV2,
} from "../../../packages/runtime-contracts/src/product-command.js";
import { command, fixture, submissions } from "./pi-durable-command.fixture.ts";

it("stores future sequence receipts immediately, waits on gaps, then consumes one supported done boundary at a time", async () => {
	await fixture("candidate-sequence", async (storage, open, control) => {
		let host = await open();
		const third = command(3, control.now);
		const ack = await host.acceptCandidate(third);
		expect(ack).toMatchObject({ acceptedPosition: 3, receiptId: "receipt-3" });
		await host.alarm();
		expect(submissions(storage)).toBe(0);
		await host.acceptCandidate(command(1, control.now));
		await host.acceptCandidate(command(2, control.now));
		for (let expected = 1; expected <= 3; expected++) {
			await host.alarm();
			await expect.poll(() => control.calls()).toBe(expected);
			await expect
				.poll(async () => {
					await host.reconcile();
					return storage.sql
						.exec(
							"SELECT state FROM host_members WHERE assistant=?",
							`assistant-${expected}`,
						)
						.one().state;
				})
				.toBe("complete");
			if (expected < 3) {
				await host.joinInvocation();
				host = await open();
			}
		}
		await host.alarm();
		expect(submissions(storage)).toBe(3);
		expect(await host.acceptCandidate(third)).toEqual(ack);
		await host.alarm();
		expect(control.calls()).toBe(3);
	});
});
it("cold Stop needs no root or model selection and accounts every late assistant without reviving the fenced run", async () => {
	await fixture("candidate-cold-stop", async (storage, open, control) => {
		let host = await open();
		const initial = command(1, control.now);
		const stop: CommandV2 = {
			version: 2,
			kind: "stop",
			commandId: "stop",
			commandSeq: 4,
			userId: "owner",
			projectId: "project",
			workspaceSessionId: "workspace",
			runtimeOwnerVersion: 1,
			receiptId: "stop-receipt",
			acceptedAt: control.now,
			deadlineAt: control.now + 900000,
			payloadDigest: "d".repeat(64),
			targetRunId: "command-1",
		};
		const ack = await host.acceptCandidate(stop, initial);
		expect(
			Number(
				storage.sql.exec("SELECT count(*) AS n FROM conversations").one().n,
			),
		).toBe(0);
		const epoch = storage.sql
			.exec("SELECT epoch FROM host_runs WHERE id='command-1'")
			.one().epoch;
		await host.yield();
		await host.awaitClosure();
		host = await open();
		for (const input of [
			initial,
			command(2, control.now),
			command(3, control.now),
		]) {
			const receipt = await host.acceptCandidate(input);
			expect(await host.acceptCandidate(input)).toEqual(receipt);
		}
		expect(await host.acceptCandidate(stop, initial)).toEqual(ack);
		await host.alarm();
		expect(submissions(storage)).toBe(0);
		expect(control.calls()).toBe(0);
		expect(
			storage.sql
				.exec("SELECT epoch,state FROM host_runs WHERE id='command-1'")
				.one(),
		).toMatchObject({ epoch, state: "canceled" });
		expect(
			storage.sql.exec("SELECT state FROM host_members").toArray(),
		).toEqual([{ state: "failed" }, { state: "failed" }, { state: "failed" }]);
		expect(
			storage.sql.exec("SELECT state FROM host_projections").toArray(),
		).toHaveLength(3);
	});
});
it("cancels a missing command durably without skipping an unrelated unknown predecessor", async () => {
	await fixture("candidate-cancel-gap", async (storage, open, control) => {
		const host = await open();
		const target = command(2, control.now);
		const cancel: CommandV2 = {
			version: 2,
			kind: "cancel",
			commandId: "cancel",
			commandSeq: 3,
			userId: "owner",
			projectId: "project",
			workspaceSessionId: "workspace",
			runtimeOwnerVersion: 1,
			receiptId: "cancel-receipt",
			acceptedAt: control.now,
			deadlineAt: control.now + 900000,
			payloadDigest: "c".repeat(64),
			targetCommandId: target.commandId,
		};
		const ack = await host.acceptCandidate(cancel, target);
		await host.alarm();
		expect(submissions(storage)).toBe(0);
		expect(
			storage.sql.exec("SELECT nextSequence FROM host_product_cursor").one()
				.nextSequence,
		).toBe(1);
		expect(storage.sql.exec("SELECT state FROM host_members").one().state).toBe(
			"failed",
		);
		expect(await host.acceptCandidate(cancel, target)).toEqual(ack);
		await host.acceptCandidate(command(1, control.now));
		await host.alarm();
		await expect.poll(() => control.calls()).toBe(1);
		await expect
			.poll(async () => {
				await host.reconcile();
				return storage.sql
					.exec("SELECT state FROM host_members WHERE assistant='assistant-1'")
					.one().state;
			})
			.toBe("complete");
		await host.alarm();
		expect(submissions(storage)).toBe(1);
		expect(
			storage.sql.exec("SELECT nextSequence FROM host_product_cursor").one()
				.nextSequence,
		).toBe(4);
	});
});
it.each([
	"started",
	"expired",
] as const)("recovers a lost %s product acknowledgment across close/reopen with one immutable decision", async (fate) => {
	await fixture(
		`candidate-decision-${fate}`,
		async (storage, open, control) => {
			let host = await open();
			const input = command(1, control.now);
			await host.acceptCandidate(input);
			if (fate === "expired") control.now = input.deadlineAt;
			control.loseDecision = true;
			await expect(host.alarm()).rejects.toThrow(
				"Lost decision acknowledgment",
			);
			expect(submissions(storage)).toBe(0);
			const decision = control.decisions.get(input.commandId);
			expect(decision?.decision).toBe(fate);
			if (fate === "expired") {
				expect(
					storage.sql.exec("SELECT state FROM host_members").one().state,
				).toBe("failed");
				expect(
					storage.sql.exec("SELECT state FROM host_projections").one().state,
				).toBe("failed");
			}
			control.loseDecision = false;
			await host.yield();
			await host.awaitClosure();
			host = await open();
			await host.alarm();
			if (fate === "started") {
				await expect.poll(() => control.calls()).toBe(1);
				await expect
					.poll(async () => {
						await host.reconcile();
						return storage.sql.exec("SELECT state FROM host_members").one()
							.state;
					})
					.toBe("complete");
			} else {
				expect(control.calls()).toBe(0);
				expect(
					storage.sql.exec("SELECT state FROM host_members").one().state,
				).toBe("failed");
			}
			expect(control.decisions.get(input.commandId)).toEqual(decision);
			expect(submissions(storage)).toBe(fate === "started" ? 1 : 0);
		},
	);
});
it.each([
	"before-submit",
	"after-submit",
] as const)("reopens %s with original request identity and at most one logical submission", async (point) => {
	await fixture(`candidate-${point}`, async (storage, open, control) => {
		let host = await open();
		const input = command(1, control.now);
		await host.acceptCandidate(input);
		control.fault = point;
		await expect(host.alarm()).rejects.toThrow(`Injected ${point}`);
		expect(submissions(storage)).toBe(point === "before-submit" ? 0 : 1);
		control.fault = undefined;
		await host.yield();
		await host.awaitClosure();
		host = await open();
		await host.alarm();
		if (point === "after-submit") {
			expect(
				storage.sql.exec("SELECT status FROM submissions").one().status,
			).toBe("unanswered");
			await host.alarm();
			expect(control.calls()).toBe(0);
			expect(
				storage.sql.exec("SELECT state FROM host_members").one().state,
			).toBe("failed");
			expect(storage.sql.exec("SELECT state FROM host_runs").one().state).toBe(
				"failed",
			);
			expect(
				storage.sql.exec("SELECT state FROM host_projections").one().state,
			).toBe("failed");
		} else {
			await expect.poll(() => control.calls()).toBe(1);
			await expect
				.poll(async () => {
					await host.reconcile();
					return storage.sql.exec("SELECT state FROM host_members").one().state;
				})
				.toBe("complete");
		}
		expect(submissions(storage)).toBe(1);
		expect(await host.acceptCandidate(input)).toMatchObject({
			receiptId: input.receiptId,
		});
	});
});
it("repairs exact numeric membership in an immediate provider callback before submit returns", async () => {
	await fixture(
		"candidate-immediate-provider",
		async (storage, open, control) => {
			const host = await open();
			const input = command(1, control.now);
			await host.acceptCandidate(input);
			let entered = false;
			control.afterSubmission = async () => {
				expect(
					storage.sql.exec("SELECT submission FROM host_commands").one()
						.submission,
				).toBeNull();
				await expect.poll(() => control.calls()).toBe(1);
				expect(
					storage.sql.exec("SELECT submission FROM host_commands").one()
						.submission,
				).not.toBeNull();
				expect(
					storage.sql.exec("SELECT command FROM host_tasks").one().command,
				).toBe(input.commandId);
				expect(control.decisions.get(input.commandId)?.decision).toBe(
					"started",
				);
				entered = true;
			};
			await host.alarm();
			expect(entered).toBe(true);
			expect(submissions(storage)).toBe(1);
		},
	);
});
it("repairs a failed alarm registration from retained encrypted acceptance on reopen", async () => {
	await fixture("candidate-alarm-loss", async (storage, open, control) => {
		let host = await open();
		const input = command(1, control.now);
		control.fault = "alarm";
		await expect(host.acceptCandidate(input)).rejects.toThrow("Injected alarm");
		expect(
			storage.sql.exec("SELECT count(*) AS n FROM host_product_commands").one()
				.n,
		).toBe(1);
		control.fault = undefined;
		await host.yield();
		await host.awaitClosure();
		host = await open();
		expect(await storage.getAlarm()).not.toBeNull();
		expect(await host.acceptCandidate(input)).toMatchObject({
			acceptedPosition: 1,
		});
		await host.alarm();
		await expect.poll(() => control.calls()).toBe(1);
		expect(submissions(storage)).toBe(1);
	});
});
it.each([
	"stop",
	"cancel",
] as const)("returns the original concurrent identical %s acknowledgment without poisoning storage", async (kind) => {
	await fixture(
		`candidate-concurrent-${kind}`,
		async (storage, open, control) => {
			const host = await open();
			const target = command(1, control.now);
			const input = parseCommandV2({
				version: 2,
				userId: "owner",
				projectId: "project",
				workspaceSessionId: "workspace",
				runtimeOwnerVersion: 1,
				acceptedAt: target.acceptedAt,
				deadlineAt: target.deadlineAt,
				kind,
				commandId: kind,
				commandSeq: 2,
				receiptId: `${kind}-receipt`,
				payloadDigest: "b".repeat(64),
				...(kind === "stop"
					? { targetRunId: target.commandId }
					: { targetCommandId: target.commandId }),
			});
			const acknowledgments = await Promise.all([
				host.acceptCandidate(input, target),
				host.acceptCandidate(input, target),
			]);
			expect(acknowledgments[0]).toEqual(acknowledgments[1]);
			const epoch = storage.sql.exec("SELECT epoch FROM host_runs").one().epoch;
			expect(await host.acceptCandidate(input, target)).toEqual(
				acknowledgments[0],
			);
			expect(storage.sql.exec("SELECT epoch FROM host_runs").one().epoch).toBe(
				epoch,
			);
			expect(
				storage.sql.exec("SELECT * FROM host_safety").toArray(),
			).toHaveLength(0);
			expect(submissions(storage)).toBe(0);
		},
	);
});
it("retains exact expiry and failed projection when encrypted start preparation crosses the queue deadline", async () => {
	await fixture(
		"candidate-preparation-expiry",
		async (storage, open, control) => {
			let host = await open();
			const input = command(1, control.now);
			await host.acceptCandidate(input);
			control.beforeTransition = (point) => {
				if (point === "intent") {
					control.beforeTransition = undefined;
					control.now = input.deadlineAt;
				}
			};
			await host.alarm();
			const fate = control.decisions.get(input.commandId);
			expect(fate).toMatchObject({
				decision: "expired",
				queueDeadlineAt: input.deadlineAt,
				payloadDigest: input.payloadDigest,
			});
			expect(
				storage.sql.exec("SELECT state FROM host_members").one().state,
			).toBe("failed");
			expect(
				storage.sql.exec("SELECT state FROM host_projections").one().state,
			).toBe("failed");
			expect(
				storage.sql.exec("SELECT * FROM host_safety").toArray(),
			).toHaveLength(0);
			expect(submissions(storage)).toBe(0);
			expect(control.calls()).toBe(0);
			await host.yield();
			await host.awaitClosure();
			host = await open();
			await host.alarm();
			expect(control.decisions.get(input.commandId)).toEqual(fate);
			expect(submissions(storage)).toBe(0);
		},
	);
});
it.each([
	"reconcile",
	"configuration",
] as const)("actually closes while candidate %s is held and denies the released continuation", async (phase) => {
	await fixture(
		`candidate-canceled-${phase}`,
		async (storage, open, control) => {
			const host = await open();
			const input = command(1, control.now);
			await host.acceptCandidate(input);
			if (phase === "reconcile") control.now = input.deadlineAt;
			let entered = false;
			let release = () => {};
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			control[phase] = async () => {
				entered = true;
				await held;
			};
			const alarm = host.alarm().catch(() => {});
			try {
				await expect.poll(() => entered).toBe(true);
				const close = host.yield();
				let timer: ReturnType<typeof setTimeout> | undefined;
				try {
					expect(
						await Promise.race([
							close.then(() => "closed"),
							new Promise<string>((resolve) => {
								timer = setTimeout(() => resolve("pending"), 1200);
							}),
						]),
					).toBe("closed");
				} finally {
					clearTimeout(timer);
				}
				await host.awaitClosure();
			} finally {
				release();
				await alarm;
			}
			expect(submissions(storage)).toBe(0);
			expect(control.calls()).toBe(0);
			expect(
				storage.sql.exec("SELECT * FROM host_safety").toArray(),
			).toHaveLength(0);
		},
	);
});
