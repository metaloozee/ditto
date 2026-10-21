/**
 * Global admission for candidate execution and model work. A claim counts
 * against its pool from acquisition until termination evidence releases it.
 * Claims have no lease: an expired timer never proves that a process ended,
 * so a live isolated executor keeps its slot. Stop, revocation and cleanup
 * never acquire a claim.
 */

export const CAPACITY_KINDS = [
	"executor",
	"builder",
	"preview",
	"model",
] as const;
export type CapacityKind = (typeof CAPACITY_KINDS)[number];
export type CapacityPool = "execution" | "model";

export type CapacityLimits = { global: number; perUser: number };
export type CandidateCapacityPolicy = Record<CapacityPool, CapacityLimits>;

/**
 * Configurable safety limits, not platform entitlements. Execution keeps the
 * existing 20 global and two per-user slots. Concurrent model requests are
 * bounded conservatively at one per execution slot.
 */
export const CANDIDATE_CAPACITY_POLICY: CandidateCapacityPolicy = {
	execution: { global: 20, perUser: 2 },
	model: { global: 20, perUser: 2 },
};

export const poolOf = (kind: CapacityKind): CapacityPool =>
	kind === "model" ? "model" : "execution";

/** Proof that the owner's process ended; nothing else releases a claim. */
export type TerminationEvidence = {
	terminated: true;
	/** Where the proof came from, such as a stopped container or a settled fetch. */
	source: string;
};

export type CapacityClaimResult =
	| { status: "claimed"; claimId: string; duplicate: boolean }
	| { status: "full"; scope: "global" | "user" }
	/** The owner already ended; a released claim is never revived. */
	| { status: "released"; claimId: string };

export function parseTerminationEvidence(value: unknown): TerminationEvidence {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		Object.keys(value).sort().join(",") !== "source,terminated" ||
		(value as { terminated?: unknown }).terminated !== true
	)
		throw new Error("Termination evidence is required");
	const source = (value as { source?: unknown }).source;
	if (typeof source !== "string" || source.length < 1 || source.length > 256)
		throw new Error("Termination evidence is required");
	return { terminated: true, source };
}

function assertLimits(policy: CandidateCapacityPolicy) {
	for (const limits of Object.values(policy))
		if (
			!Number.isSafeInteger(limits.global) ||
			!Number.isSafeInteger(limits.perUser) ||
			limits.perUser < 1 ||
			limits.global < limits.perUser
		)
			throw new Error("Invalid capacity policy");
}

export class CandidateCapacity {
	constructor(
		private db: D1Database,
		private policy: CandidateCapacityPolicy = CANDIDATE_CAPACITY_POLICY,
		private now: () => number = Date.now,
		private createId: () => string = () => crypto.randomUUID(),
	) {
		assertLimits(policy);
	}

	/** Statement that inserts one live claim only while both limits hold. */
	acquireStatement(
		kind: CapacityKind,
		ownerKey: string,
		userId: string,
		id: string,
	): D1PreparedStatement {
		const pool = poolOf(kind);
		const limits = this.policy[pool];
		return this.db
			.prepare(
				`INSERT INTO candidate_capacity_claims(id,pool,kind,ownerKey,userId,state,claimedAt)
SELECT ?,?,?,?,?,'live',? WHERE
 (SELECT count(*) FROM candidate_capacity_claims WHERE pool=? AND state='live')<?
 AND (SELECT count(*) FROM candidate_capacity_claims WHERE pool=? AND state='live' AND userId=?)<?
ON CONFLICT(kind,ownerKey) DO NOTHING`,
			)
			.bind(
				id,
				pool,
				kind,
				ownerKey,
				userId,
				this.now(),
				pool,
				limits.global,
				pool,
				userId,
				limits.perUser,
			);
	}

	/**
	 * Acquires or re-acknowledges the owner's claim. A repeated acquisition
	 * for the same owner returns its existing claim and never takes a second
	 * slot, so a restart or a lost acknowledgment cannot double-claim.
	 */
	async acquire(
		kind: CapacityKind,
		ownerKey: string,
		userId: string,
		id: string = this.createId(),
	): Promise<CapacityClaimResult> {
		const [, existing] = await this.db.batch([
			this.acquireStatement(kind, ownerKey, userId, id),
			this.db
				.prepare(
					"SELECT id,state,userId FROM candidate_capacity_claims WHERE kind=? AND ownerKey=?",
				)
				.bind(kind, ownerKey),
		]);
		const row = existing.results[0] as
			| { id: string; state: "live" | "released"; userId: string }
			| undefined;
		if (row) {
			if (row.userId !== userId) throw new Error("Capacity owner mismatch");
			if (row.state === "released")
				return { status: "released", claimId: row.id };
			return { status: "claimed", claimId: row.id, duplicate: row.id !== id };
		}
		const user = await this.db
			.prepare(
				"SELECT count(*) AS n FROM candidate_capacity_claims WHERE pool=? AND state='live' AND userId=?",
			)
			.bind(poolOf(kind), userId)
			.first<{ n: number }>();
		return {
			status: "full",
			scope:
				(user?.n ?? 0) >= this.policy[poolOf(kind)].perUser ? "user" : "global",
		};
	}

	/** Releases a live claim only with termination evidence. Idempotent. */
	async release(
		kind: CapacityKind,
		ownerKey: string,
		evidence: unknown,
	): Promise<"released" | "already_released" | "unknown"> {
		const proof = parseTerminationEvidence(evidence);
		const updated = await this.db
			.prepare(
				"UPDATE candidate_capacity_claims SET state='released',releasedAt=?,evidence=? WHERE kind=? AND ownerKey=? AND state='live'",
			)
			.bind(this.now(), JSON.stringify(proof), kind, ownerKey)
			.run();
		if (updated.meta.changes === 1) return "released";
		const row = await this.db
			.prepare(
				"SELECT state FROM candidate_capacity_claims WHERE kind=? AND ownerKey=?",
			)
			.bind(kind, ownerKey)
			.first<{ state: string }>();
		return row ? "already_released" : "unknown";
	}

	/**
	 * Releases only the claim with this id, so a caller that lost track of
	 * its own acquisition never releases a duplicate caller's live claim.
	 */
	async releaseClaim(
		kind: CapacityKind,
		ownerKey: string,
		claimId: string,
		evidence: unknown,
	): Promise<boolean> {
		const proof = parseTerminationEvidence(evidence);
		const updated = await this.db
			.prepare(
				"UPDATE candidate_capacity_claims SET state='released',releasedAt=?,evidence=? WHERE id=? AND kind=? AND ownerKey=? AND state='live'",
			)
			.bind(this.now(), JSON.stringify(proof), claimId, kind, ownerKey)
			.run();
		return updated.meta.changes === 1;
	}

	async live(kind: CapacityKind, ownerKey: string): Promise<boolean> {
		return (
			(await this.db
				.prepare(
					"SELECT 1 FROM candidate_capacity_claims WHERE kind=? AND ownerKey=? AND state='live'",
				)
				.bind(kind, ownerKey)
				.first()) !== null
		);
	}

	async counts(): Promise<Record<CapacityPool, number>> {
		const rows = await this.db
			.prepare(
				"SELECT pool,count(*) AS n FROM candidate_capacity_claims WHERE state='live' GROUP BY pool",
			)
			.all<{ pool: CapacityPool; n: number }>();
		const counts = { execution: 0, model: 0 };
		for (const row of rows.results) counts[row.pool] = row.n;
		return counts;
	}
}

/**
 * Seed builders in the candidate execution pool. Seed settlement calls
 * `release` only after the builder container was destroyed; `hold` has
 * nothing to do because a claim never lapses on its own.
 */
export function candidateBuilderCapacity(capacity: CandidateCapacity) {
	return {
		async acquire(identity: { identityId: string; userId: string }) {
			const claim = await capacity.acquire(
				"builder",
				identity.identityId,
				identity.userId,
			);
			return claim.status === "claimed";
		},
		async release(identityId: string) {
			await capacity.release("builder", identityId, {
				terminated: true,
				source: "builder_destroyed",
			});
		},
		async hold(_identity: { identityId: string; userId: string }) {},
	};
}
