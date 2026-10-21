import { env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import migration from "../../web/migrations/0025_candidate_capacity.sql?raw";
import {
	CANDIDATE_CAPACITY_POLICY,
	CandidateCapacity,
	type CandidateCapacityPolicy,
	candidateBuilderCapacity,
} from "../../web/src/lib/candidate-capacity";

const evidence = { terminated: true, source: "container_stopped" } as const;
let clock = 1_000;
const ledger = (policy: CandidateCapacityPolicy = CANDIDATE_CAPACITY_POLICY) =>
	new CandidateCapacity(env.DB, policy, () => clock);
const small: CandidateCapacityPolicy = {
	execution: { global: 3, perUser: 2 },
	model: { global: 2, perUser: 1 },
};

beforeEach(async () => {
	clock = 1_000;
	await env.DB.exec("DROP TABLE IF EXISTS candidate_capacity_claims");
	for (const statement of migration.split("--> statement-breakpoint"))
		if (statement.trim()) await env.DB.exec(statement.replaceAll("\n", " "));
});

it("keeps the default 20 global and two per-user execution slots as configurable policy", async () => {
	expect(CANDIDATE_CAPACITY_POLICY.execution).toEqual({
		global: 20,
		perUser: 2,
	});
	for (const bad of [
		{ ...small, execution: { global: 1, perUser: 2 } },
		{ ...small, model: { global: 2, perUser: 0 } },
		{ ...small, model: { global: 2.5, perUser: 1 } },
	])
		expect(() => ledger(bad)).toThrow("Invalid capacity policy");
});

it("shares one execution pool across executors, builders and preview, with a separate model pool", async () => {
	const capacity = ledger(small);
	expect(await capacity.acquire("executor", "s1:i1", "alice")).toMatchObject({
		status: "claimed",
		duplicate: false,
	});
	expect(await capacity.acquire("builder", "b1", "alice")).toMatchObject({
		status: "claimed",
	});
	// Alice's two execution slots are used whatever their kind.
	expect(await capacity.acquire("preview", "s2:i1", "alice")).toEqual({
		status: "full",
		scope: "user",
	});
	expect(await capacity.acquire("executor", "s3:i1", "bob")).toMatchObject({
		status: "claimed",
	});
	expect(await capacity.acquire("preview", "s4:i1", "carol")).toEqual({
		status: "full",
		scope: "global",
	});
	// Model requests have their own limits and never use an execution slot.
	expect(await capacity.acquire("model", "s1:effect-1", "alice")).toMatchObject(
		{ status: "claimed" },
	);
	expect(await capacity.acquire("model", "s1:effect-2", "alice")).toEqual({
		status: "full",
		scope: "user",
	});
	expect(await capacity.counts()).toEqual({ execution: 3, model: 1 });
});

it("lets concurrent demands for the last slots claim exactly the limit", async () => {
	const capacity = ledger(small);
	await capacity.acquire("executor", "held", "zed");
	const kinds = [
		"executor",
		"builder",
		"preview",
		"executor",
		"builder",
	] as const;
	const results = await Promise.all(
		kinds.map((kind, index) =>
			capacity.acquire(kind, `owner-${index}`, `user-${index}`),
		),
	);
	expect(results.filter((r) => r.status === "claimed")).toHaveLength(2);
	expect(results.filter((r) => r.status === "full")).toHaveLength(3);
	const models = await Promise.all(
		[1, 2, 3, 4].map((n) => capacity.acquire("model", `m-${n}`, `user-${n}`)),
	);
	expect(models.filter((r) => r.status === "claimed")).toHaveLength(2);
	expect(await capacity.counts()).toEqual({ execution: 3, model: 2 });
});

it("acknowledges a repeated claim for the same owner without a second slot", async () => {
	const capacity = ledger(small);
	const [a, b] = await Promise.all([
		capacity.acquire("executor", "s1:i1", "alice"),
		capacity.acquire("executor", "s1:i1", "alice"),
	]);
	expect(a.status === "claimed" && b.status === "claimed").toBe(true);
	if (a.status !== "claimed" || b.status !== "claimed") return;
	expect(a.claimId).toBe(b.claimId);
	expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
	// A restart acknowledges the same claim again.
	expect(await ledger(small).acquire("executor", "s1:i1", "alice")).toEqual({
		status: "claimed",
		claimId: a.claimId,
		duplicate: true,
	});
	await expect(
		capacity.acquire("executor", "s1:i1", "mallory"),
	).rejects.toThrow("Capacity owner mismatch");
	// A caller that lost its own acquisition releases nothing it does not hold.
	expect(
		await capacity.releaseClaim("executor", "s1:i1", "not-mine", evidence),
	).toBe(false);
	expect(await capacity.live("executor", "s1:i1")).toBe(true);
	expect(
		await capacity.releaseClaim("executor", "s1:i1", a.claimId, evidence),
	).toBe(true);
	expect(await capacity.counts()).toEqual({ execution: 0, model: 0 });
});

it("never releases on time alone, only with termination evidence, and never revives a released owner", async () => {
	const capacity = ledger(small);
	await capacity.acquire("executor", "s1:i1", "alice");
	await capacity.acquire("executor", "s2:i1", "alice");
	// Hours later the isolated executor may still run: it keeps counting.
	clock += 6 * 60 * 60 * 1000;
	expect(await capacity.live("executor", "s1:i1")).toBe(true);
	expect(await capacity.acquire("executor", "s3:i1", "alice")).toEqual({
		status: "full",
		scope: "user",
	});
	for (const proof of [
		undefined,
		{},
		{ expired: true },
		{ terminated: false, source: "lease" },
		{ terminated: true },
		{ terminated: true, source: "" },
		{ terminated: true, source: "x", extra: 1 },
	])
		await expect(capacity.release("executor", "s1:i1", proof)).rejects.toThrow(
			"Termination evidence is required",
		);
	expect(await capacity.live("executor", "s1:i1")).toBe(true);
	expect(await capacity.release("executor", "s1:i1", evidence)).toBe(
		"released",
	);
	expect(await capacity.release("executor", "s1:i1", evidence)).toBe(
		"already_released",
	);
	expect(await capacity.release("executor", "missing", evidence)).toBe(
		"unknown",
	);
	expect(await capacity.acquire("executor", "s1:i1", "alice")).toMatchObject({
		status: "released",
	});
	// The freed slot goes to a new owner, such as a new executor incarnation.
	expect(await capacity.acquire("executor", "s1:i2", "alice")).toMatchObject({
		status: "claimed",
	});
	await expect(
		env.DB.prepare(
			"UPDATE candidate_capacity_claims SET state='live',releasedAt=NULL,evidence=NULL WHERE ownerKey='s1:i1'",
		).run(),
	).rejects.toThrow();
});

it("accounts seed builders in the execution pool and frees them only on destroyed-builder release", async () => {
	const capacity = ledger(small);
	const builders = candidateBuilderCapacity(capacity);
	const seedBuilders = builders;
	expect(
		await seedBuilders.acquire({ identityId: "b1", userId: "alice" }),
	).toBe(true);
	expect(
		await seedBuilders.acquire({ identityId: "b2", userId: "alice" }),
	).toBe(true);
	expect(
		await seedBuilders.acquire({ identityId: "b3", userId: "alice" }),
	).toBe(false);
	// An unproven termination holds; nothing lapses.
	await seedBuilders.hold({ identityId: "b1", userId: "alice" });
	clock += 24 * 60 * 60 * 1000;
	expect(await capacity.live("builder", "b1")).toBe(true);
	await seedBuilders.release("b1");
	expect(await capacity.live("builder", "b1")).toBe(false);
	expect(
		await seedBuilders.acquire({ identityId: "b3", userId: "alice" }),
	).toBe(true);
});
