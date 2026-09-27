import {
	type CoordinatorSql,
	isFatalLatched,
	listDueExpiredEffects,
	listDueExpiredRuns,
	listDueWakeups,
	listPendingProjections,
	markProjection,
	markWakeup,
	nextWorkDeadline,
	type ProjectionRow,
	persistFutureCoordinatorWork,
	RECONCILE_MAX_INTENTS,
	RECONCILE_MAX_MS,
	updateEffectState,
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
	consumeReadyCommands: (now: number, max: number, stopAt: number) => number;
	settleExpiredRuns: (now: number, max: number, stopAt: number) => number;
	settleExpiredEffects: (now: number, max: number, stopAt: number) => number;
	settleStoppingRuns: (now: number, max: number, stopAt: number) => number;
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
	const stopAt = started + maxMs;
	let processed = 0;

	processed += options.sql.transaction(() => {
		if (options.clock.now() >= stopAt) return 0;
		let used = 0;
		used += options.hooks.consumeReadyCommands(started, maxIntents, stopAt);
		if (options.clock.now() >= stopAt || used >= maxIntents) return used;
		used += options.hooks.settleExpiredRuns(started, maxIntents - used, stopAt);
		if (options.clock.now() >= stopAt || used >= maxIntents) return used;
		used += options.hooks.settleExpiredEffects(
			started,
			maxIntents - used,
			stopAt,
		);
		if (options.clock.now() >= stopAt || used >= maxIntents) return used;
		used += options.hooks.settleStoppingRuns(
			started,
			maxIntents - used,
			stopAt,
		);
		return used;
	});

	const wakeupBudget = Math.max(0, maxIntents - processed);
	const due =
		wakeupBudget === 0 || options.clock.now() - started >= maxMs
			? []
			: options.sql.transaction(() =>
					listDueWakeups(options.sql, started, wakeupBudget),
				);

	for (const wakeup of due) {
		if (processed >= maxIntents || options.clock.now() - started >= maxMs) {
			break;
		}
		options.sql.transaction(() => {
			markWakeup(options.sql, wakeup.id, "processed");
		});
		processed += 1;
	}

	const projectionBudget = Math.max(0, maxIntents - processed);
	const pending =
		projectionBudget === 0 || options.clock.now() - started >= maxMs
			? []
			: options.sql.transaction(() =>
					listPendingProjections(options.sql, projectionBudget),
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
		const observedAt = options.clock.now();
		persistFutureCoordinatorWork(options.sql, observedAt);
		const lag = listPendingProjections(options.sql, 1).length;
		return {
			nextDeadlineAt: nextWorkDeadline(options.sql, observedAt),
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
	max = RECONCILE_MAX_INTENTS,
	clock?: () => number,
	stopAt?: number,
): number {
	if (stopAt != null && clock != null && clock() >= stopAt) return 0;
	let settled = 0;
	for (const run of listDueExpiredRuns(sql, now, max)) {
		if (stopAt != null && clock != null && clock() >= stopAt) break;
		if (settled >= max) break;
		updateRunState(sql, run.run_id, {
			state: "failed",
			updatedAt: now,
			blockedReviewReason: "recovery_deadline_expired",
		});
		onTerminal(run.run_id);
		settled += 1;
	}
	return settled;
}

export function settleExpiredEffectsNow(
	sql: CoordinatorSql,
	now: number,
	onUnknown: (input: {
		runId: string;
		assistantEntryId: string;
		toolCallId: string;
		attempt: number;
	}) => void,
	max = RECONCILE_MAX_INTENTS,
	clock?: () => number,
	stopAt?: number,
): number {
	if (stopAt != null && clock != null && clock() >= stopAt) return 0;
	let settled = 0;
	for (const effect of listDueExpiredEffects(sql, now, max)) {
		if (stopAt != null && clock != null && clock() >= stopAt) break;
		if (settled >= max) break;
		updateEffectState(
			sql,
			{
				runId: effect.run_id,
				assistantEntryId: effect.assistant_entry_id,
				toolCallId: effect.tool_call_id,
				attempt: Number(effect.attempt),
			},
			{ state: "outcome_unknown" },
		);
		updateRunState(sql, effect.run_id, {
			state: "failed",
			updatedAt: now,
			blockedReviewReason: "effect_deadline_expired",
		});
		onUnknown({
			runId: effect.run_id,
			assistantEntryId: effect.assistant_entry_id,
			toolCallId: effect.tool_call_id,
			attempt: Number(effect.attempt),
		});
		settled += 1;
	}
	return settled;
}
