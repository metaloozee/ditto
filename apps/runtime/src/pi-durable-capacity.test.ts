import { expect, it } from "vitest";
import { command, fixture, submissions } from "./pi-durable-command.fixture.ts";

/**
 * The product holds ordinary work while execution capacity is full and
 * delivers it once a slot frees. Its fixed 15-minute queue deadline is the
 * runtime's to apply: a start already recorded always wins over a later
 * expiry, and late delivery never resets the deadline.
 */

it("starts work delivered after a capacity wait while its queue deadline holds, and expires it exactly at the deadline", async () => {
	for (const fate of ["started", "expired"] as const)
		await fixture(`capacity-late-${fate}`, async (storage, open, control) => {
			const host = await open();
			const input = command(1, control.now);
			// The product accepted the command, then held it for capacity.
			control.now = input.deadlineAt - (fate === "started" ? 1 : 0);
			await host.acceptCandidate(input);
			await host.alarm();
			expect(control.decisions.get(input.commandId)).toMatchObject({
				decision: fate,
				queueDeadlineAt: input.deadlineAt,
			});
			if (fate === "started") {
				await expect.poll(() => control.calls()).toBe(1);
				expect(submissions(storage)).toBe(1);
			} else {
				expect(control.calls()).toBe(0);
				expect(submissions(storage)).toBe(0);
				expect(
					storage.sql.exec("SELECT state FROM host_members").one().state,
				).toBe("failed");
			}
		});
});

it("keeps a recorded start when the queue deadline passes before the product learns of it", async () => {
	await fixture(
		"capacity-start-before-expiry",
		async (storage, open, control) => {
			let host = await open();
			const input = command(1, control.now);
			await host.acceptCandidate(input);
			control.loseDecision = true;
			await expect(host.alarm()).rejects.toThrow(
				"Lost decision acknowledgment",
			);
			const decision = control.decisions.get(input.commandId);
			expect(decision?.decision).toBe("started");
			control.loseDecision = false;
			await host.yield();
			await host.awaitClosure();
			// The restart lands after the queue deadline.
			control.now = input.deadlineAt + 1;
			host = await open();
			await host.alarm();
			expect(control.decisions.get(input.commandId)).toEqual(decision);
			await expect.poll(() => control.calls()).toBe(1);
			expect(submissions(storage)).toBe(1);
			expect(
				storage.sql.exec("SELECT state FROM host_members").one().state,
			).not.toBe("failed");
		},
	);
});
