import { env, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { PROJECTION_LIMITS } from "../../../packages/runtime-contracts/src/projection.js";
import {
	command,
	completeFirst,
	fixture,
	rows,
	stop,
} from "./pi-durable-candidate.fixture.ts";
import { PiDurableHost } from "./pi-durable-host.ts";

const tables = (storage: DurableObjectStorage) =>
	rows(storage, "SELECT name FROM sqlite_master ORDER BY name");

it("observes an untouched session without creating storage, alarms or a host", async () => {
	await runInDurableObject(
		env.PI_HOST_STORAGE.getByName("observe-empty"),
		async (_instance, state) => {
			const before = tables(state.storage);
			expect(PiDurableHost.observe(state.storage)).toEqual({
				version: 1,
				cursor: 0,
				snapshot: {
					runs: [],
					assistants: [],
					health: { projectionLag: 0, safetyStopped: false },
				},
				events: [],
				more: false,
			});
			expect(tables(state.storage)).toEqual(before);
			expect(await state.storage.getAlarm()).toBeNull();
		},
	);
});

it("attaches by snapshot then later events with no gap, and replaces a stale cursor", async () => {
	await fixture("observe-attach", async (storage, open, control) => {
		control.product.mode = "throw";
		let host = await open();
		await host.acceptCandidate(command(1, control.now));
		const attached = PiDurableHost.observe(storage);
		expect(attached.events).toEqual([]);
		await completeFirst(storage, host, control);
		await host.joinInvocation();
		host = await open();
		await host.acceptCandidate(command(2, control.now));
		await host.acceptCandidate(stop(3, control.now), command(1, control.now));

		const later = PiDurableHost.observe(storage, attached.cursor);
		expect(later.snapshot).toBeUndefined();
		const positions = later.events.map((event) => event.position);
		expect(positions[0]).toBe(attached.cursor + 1);
		expect(positions).toEqual(
			positions.map((_, index) => attached.cursor + 1 + index),
		);
		expect(
			later.events.map((event) => [event.kind, event.target, event.state]),
		).toEqual(
			expect.arrayContaining([
				["assistant", "assistant-1", "complete"],
				["assistant", "assistant-2", "failed"],
			]),
		);
		expect(
			later.events.find((event) => event.target === "assistant-2"),
		).toMatchObject({
			reason: "target_run_terminal",
		});
		// Duplicate delivery from the same cursor is identical and harmless.
		expect(PiDurableHost.observe(storage, attached.cursor)).toEqual(later);
		expect(PiDurableHost.observe(storage, later.cursor).events).toEqual([]);

		const fresh = PiDurableHost.observe(storage, later.cursor + 1);
		expect(fresh.cursor).toBe(later.cursor);
		expect(fresh.snapshot).toMatchObject({
			runs: [{ id: "command-1", state: "complete" }],
			assistants: expect.arrayContaining([
				expect.objectContaining({ id: "assistant-1", applied: false }),
				expect.objectContaining({
					id: "assistant-2",
					state: "failed",
					reason: "target_run_terminal",
				}),
			]),
			health: { projectionLag: 2, safetyStopped: false },
		});
		expect(JSON.stringify(fresh)).not.toContain("Private instruction");
		expect(JSON.stringify(later)).not.toContain("Synthetic answer");
	});
});

it("bounds event pages and never schedules, alarms or dispatches while reading", async () => {
	await fixture("observe-readonly", async (storage, open, control) => {
		control.product.mode = "throw";
		const host = await open();
		await host.acceptCandidate(command(1, control.now));
		await completeFirst(storage, host, control);
		await host.joinInvocation();
		storage.sql.exec(
			`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?)
			 INSERT INTO host_events(kind,target,run,state,reason,version) SELECT 'run','command-1','command-1','complete',NULL,1 FROM n`,
			PROJECTION_LIMITS.events + 10,
		);
		const alarm = await storage.getAlarm();
		const wakeups = rows(storage, "SELECT * FROM host_wakeups ORDER BY id");
		const effects = rows(storage, "SELECT id,state FROM host_effects");
		const page = PiDurableHost.observe(storage, 0);
		expect(page.events).toHaveLength(PROJECTION_LIMITS.events);
		expect(page.more).toBe(true);
		const rest = PiDurableHost.observe(storage, page.cursor);
		expect(rest.events[0]?.position).toBe(page.cursor + 1);
		expect(await storage.getAlarm()).toBe(alarm);
		expect(rows(storage, "SELECT * FROM host_wakeups ORDER BY id")).toEqual(
			wakeups,
		);
		expect(rows(storage, "SELECT id,state FROM host_effects")).toEqual(effects);
		expect(control.calls()).toBe(1);
		expect(control.product.batches.length).toBeGreaterThan(0);
		const batches = control.product.batches.length;
		PiDurableHost.observe(storage);
		expect(control.product.batches).toHaveLength(batches);
	});
});

it("reports archive status from the host archive state and nothing else", async () => {
	await fixture("observe-archive", async (storage, open, control) => {
		const host = await open();
		await host.acceptCandidate(command(1, control.now));
		const health = () => PiDurableHost.observe(storage).snapshot?.health;
		expect(health()?.archive).toBeUndefined();
		storage.sql.exec(
			"INSERT INTO host_archives (id, command, sequence, cutoff, state) VALUES (1, 'archive-1', 2, 1, 'fenced')",
		);
		const expected = {
			fenced: "pending",
			retired: "pending",
			final: "pending",
			blocked: "blocked",
			complete: "complete",
		} as const;
		for (const [state, status] of Object.entries(expected)) {
			storage.sql.exec("UPDATE host_archives SET state=? WHERE id=1", state);
			expect(health()?.archive).toEqual({ status });
		}
		const json = JSON.stringify(PiDurableHost.observe(storage));
		for (const secret of ["pair", "seed", "evidence", "archive-1"])
			expect(json).not.toContain(secret);
	});
});
