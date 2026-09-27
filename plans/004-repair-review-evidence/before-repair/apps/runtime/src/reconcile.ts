import {
	type CoordinatorSql,
	isFatalLatched,
	listDueWakeups,
	listPendingProjections,
	listPendingWakeups,
	listRuns,
	markProjection,
	markWakeup,
	type ProjectionRow,
	RECONCILE_MAX_INTENTS,
	RECONCILE_MAX_MS,
	updateRunState,
} from "./journal.js";
import type {
	ProjectionApplyResult,
	ProjectionPayload,
} from "./product-projector.js";

export type ReconcileClock = { now: () => number };

export type ReconcileAdapters = {
	applyProjections: (
		payloads: ProjectionPayload[],
		now: number,
	) => Promise<ProjectionApplyResult[]>;
};

export type ReconcileHooks = {
	consumeReadyCommands: (now: number) => void;
	settleExpiredRuns: (now: number) => void;
};

export type ReconcileResult = {
	processed: number;
	projectionLag: number;
	nextDeadlineAt: number | null;
	fatal: boolean;
};

function parsePayload(row: ProjectionRow): ProjectionPayload {
	const record = row as Record<string, unknown>;
	const raw =
		row.payload_redacted ??
		(typeof record.payload_redacted === "string"
			? record.payload_redacted
			: null);
	if (typeof raw !== "string") {
		throw new Error("projection_payload_missing");
	}
	return JSON.parse(raw) as ProjectionPayload;
}

export async function processReconcilePass(options: {
	sql: CoordinatorSql;
	adapters: ReconcileAdapters;
	hooks: ReconcileHooks;
	clock: ReconcileClock;
	maxIntents?: number;
	maxMs?: number;
}): Promise<ReconcileResult> {
	const started = options.clock.now();
	const maxIntents = options.maxIntents ?? RECONCILE_MAX_INTENTS;
	const maxMs = options.maxMs ?? RECONCILE_MAX_MS;
	let processed = 0;

	const due = options.sql.transaction(() => {
		options.hooks.consumeReadyCommands(started);
		options.hooks.settleExpiredRuns(started);
		return listDueWakeups(options.sql, started, maxIntents);
	});

	for (const wakeup of due) {
		if (processed >= maxIntents || options.clock.now() - started >= maxMs) {
			break;
		}
		options.sql.transaction(() => {
			markWakeup(options.sql, wakeup.id, "processed");
		});
		processed += 1;
	}

	const pending = options.sql.transaction(() =>
		listPendingProjections(options.sql, maxIntents),
	);
	if (pending.length > 0 && options.clock.now() - started < maxMs) {
		let payloads: ProjectionPayload[] = [];
		try {
			payloads = pending.map(parsePayload);
		} catch {
			payloads = [];
		}
		let results: ProjectionApplyResult[] = pending.map(() => ({
			classification: "retry" as const,
			retry: true,
		}));
		if (payloads.length === pending.length) {
			try {
				results = await options.adapters.applyProjections(
					payloads,
					options.clock.now(),
				);
			} catch {
				results = pending.map(() => ({
					classification: "retry" as const,
					retry: true,
				}));
			}
		}
		try {
			for (let index = 0; index < pending.length; index += 1) {
				const row = pending[index];
				const payload = payloads[index];
				const result = results[index] ?? {
					classification: "retry" as const,
					retry: true,
				};
				if (!row) continue;
				const keyed = payload
					? {
							...row,
							target_kind: payload.targetKind,
							target_id: payload.targetId,
							coordinator_seq: payload.coordinatorSeq,
						}
					: row;
				if (result.retry) {
					markProjection(options.sql, keyed, "pending", "d1_unavailable");
					continue;
				}
				if (
					result.classification === "applied" ||
					result.classification === "already_applied" ||
					result.classification === "stale_owner" ||
					result.classification === "deleted" ||
					result.classification === "immutable_completed"
				) {
					markProjection(options.sql, keyed, "applied", result.classification);
				} else {
					markProjection(options.sql, keyed, "blocked", result.classification);
				}
			}
		} catch {
			options.sql.query(
				"UPDATE projections SET last_error_class = ? WHERE state = ?",
				"mark_failed",
				"pending",
			);
		}
		processed += pending.length;
	}

	const next = options.sql.transaction(() => {
		const remaining = listPendingWakeups(options.sql);
		const lag = listPendingProjections(options.sql, 1).length;
		const nextDeadline =
			remaining.length > 0
				? Math.min(...remaining.map((row) => Number(row.deadline_at)))
				: lag > 0
					? options.clock.now()
					: null;
		return {
			nextDeadlineAt: nextDeadline,
			projectionLag: lag,
			fatal: isFatalLatched(options.sql),
		};
	});

	return {
		processed,
		projectionLag: next.projectionLag,
		nextDeadlineAt: next.nextDeadlineAt,
		fatal: next.fatal,
	};
}

export function settleExpiredRunsNow(
	sql: CoordinatorSql,
	now: number,
	onTerminal: (runId: string) => void,
): void {
	for (const run of listRuns(sql)) {
		if (
			run.recovery_deadline_at != null &&
			Number(run.recovery_deadline_at) <= now &&
			run.state !== "complete" &&
			run.state !== "failed" &&
			run.state !== "canceled"
		) {
			updateRunState(sql, run.run_id, {
				state: "failed",
				updatedAt: now,
				blockedReviewReason: "recovery_deadline_expired",
			});
			onTerminal(run.run_id);
		}
	}
}
