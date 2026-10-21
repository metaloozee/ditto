import {
	WORKSPACE_BACKUP_DEFERRAL_MS,
	WORKSPACE_PREVIEW_PORT,
	type WorkspaceActionResultV1,
	type WorkspaceActionV1,
} from "../../../packages/runtime-contracts/src/workspace-action.js";
import {
	type ArtifactPermit,
	ArtifactStepRejected,
	createRecoveryLedger,
	type MutationScope,
	RECOVERY_STEPS,
	RecoveryDenied,
	type RecoveryStep,
} from "./pi-durable-artifacts.ts";
import type {
	CheckpointHostPort,
	PublishResult,
	RestoreFailure,
	SqlStorage,
} from "./pi-durable-checkpoints.ts";

/**
 * UI Git and preview under the runtime owner. Every action takes the same
 * exclusive mutation scope as recovery and publication, so it never overlaps
 * an agent run, a restore step or a capture. Preview is a writer outside the
 * scope: it may defer a backup until a fixed deadline after the first
 * unbacked mutation, and then it is stopped with termination evidence.
 */

/** Typed operations on fixed sandbox paths; each receives only its permit. */
export interface WorkspaceExecution {
	/** Whether the execution workspace holds a checkout at all. */
	present(permit: ArtifactPermit): Promise<boolean>;
	gitStatus(
		permit: ArtifactPermit,
		request: { branch: string },
	): Promise<{ branch: string; head: string; changed: number }>;
	/** Credential-free, hooks disabled, owned branch only, secret preflight. */
	gitCommit(
		permit: ArtifactPermit,
		request: { branch: string; message: string },
	): Promise<{ head: string; committed: boolean }>;
	/** The executor discovers the fixed preview command; the caller supplies none. */
	previewStart(
		permit: ArtifactPermit,
		request: { port: number },
	): Promise<void>;
	/** `terminated` is evidence the process and its children are gone. */
	previewStop(permit: ArtifactPermit): Promise<{ terminated: boolean }>;
}

export type WorkspaceHostPort = CheckpointHostPort & {
	/** Ordinary admission state: a fenced restore or an archive closes workspace actions. */
	admission(): "open" | "restore_in_progress" | "archived";
	/** Durable host wakeup for the next backup step. */
	wake(at: number): Promise<void>;
};

export type WorkspacePublisher = {
	publishBoundary(): Promise<PublishResult>;
	restoreFiles(): Promise<
		| { status: "restored"; pair: string }
		| { status: "deferred"; reason: string }
		| { status: "unavailable"; failures: RestoreFailure[] }
	>;
};

export type WorkspaceFault = "after-preview-stop";

const RETRY_MS = 30_000;
/** Preview restarts after a backup only for traffic this recent, or explicit demand. */
const RECENT_TRAFFIC_MS = 5 * 60_000;

export function createWorkspaceController(deps: {
	storage: SqlStorage;
	host: WorkspaceHostPort;
	execution: WorkspaceExecution;
	publisher(): WorkspacePublisher;
	branch: string;
	now(): number;
	id?(): string;
	deferralMs?: number;
	fault?(point: WorkspaceFault): void | Promise<void>;
}) {
	const { storage, host } = deps;
	const sql = storage.sql;
	const deferral = deps.deferralMs ?? WORKSPACE_BACKUP_DEFERRAL_MS;
	for (const statement of [
		"CREATE TABLE IF NOT EXISTS workspace_backup (id INTEGER PRIMARY KEY CHECK (id = 1), unbacked_since INTEGER, deadline INTEGER, CHECK ((unbacked_since IS NULL) = (deadline IS NULL)))",
		"INSERT OR IGNORE INTO workspace_backup VALUES (1, NULL, NULL)",
		"CREATE TABLE IF NOT EXISTS workspace_preview (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL CHECK (state IN ('stopped','running','unknown')), generation INTEGER NOT NULL, demand INTEGER NOT NULL CHECK (demand IN (0,1)), last_traffic INTEGER, stopped_for_backup INTEGER NOT NULL CHECK (stopped_for_backup IN (0,1)))",
		"INSERT OR IGNORE INTO workspace_preview VALUES (1, 'stopped', 0, 0, NULL, 0)",
	])
		sql.exec(statement);
	let authority: Awaited<ReturnType<CheckpointHostPort["authority"]>> = {
		current: false,
		generation: 0,
		executor: 0,
	};
	// The same executor rule as publication: one current executor, slot 1.
	const writable = () =>
		authority.current &&
		authority.executor === 1 &&
		(authority.liveExecutors ?? 1) === 1;
	const ledger = createRecoveryLedger(storage, {
		authority: () => ({
			epoch: host.epoch(),
			generation: authority.generation,
			quiescent: host.quiescent(),
			blocked: host.blocked() || !writable(),
		}),
		now: deps.now,
		id: deps.id ?? (() => crypto.randomUUID()),
	});
	const backup = () =>
		sql
			.exec<{ unbacked_since: number | null; deadline: number | null }>(
				"SELECT unbacked_since, deadline FROM workspace_backup WHERE id = 1",
			)
			.one();
	const preview = () =>
		sql
			.exec<{
				state: "stopped" | "running" | "unknown";
				generation: number;
				demand: number;
				last_traffic: number | null;
				stopped_for_backup: number;
			}>(
				"SELECT state, generation, demand, last_traffic, stopped_for_backup FROM workspace_preview WHERE id = 1",
			)
			.one();
	/** An unknown step outcome in any scope needs review before anything else runs. */
	const unresolved = () =>
		sql
			.exec("SELECT 1 FROM recovery_operations WHERE state = 'unknown' LIMIT 1")
			.toArray().length > 0;
	const overdue = () => {
		const row = backup();
		return row.deadline !== null && deps.now() >= row.deadline;
	};

	/**
	 * The first unbacked mutation fixes the deadline; later ones never move it.
	 * True when this call set it, so the caller arms the backup wakeup.
	 */
	function noteMutation(): boolean {
		if (backup().unbacked_since !== null) return false;
		const now = deps.now();
		sql.exec(
			"UPDATE workspace_backup SET unbacked_since = ?, deadline = ? WHERE id = 1",
			now,
			now + deferral,
		);
		return true;
	}

	async function acquire(): Promise<
		MutationScope | { status: "denied"; reason: "busy" | "blocked" }
	> {
		authority = await host.authority();
		try {
			return ledger.acquire("workspace");
		} catch (error) {
			if (!(error instanceof RecoveryDenied)) throw error;
			return {
				status: "denied",
				reason:
					error.reason === "outcome_unknown" || host.blocked() || unresolved()
						? "blocked"
						: "busy",
			};
		}
	}

	/** One admitted step; a lost mutation becomes unknown and keeps the scope held. */
	async function step<T>(
		scope: MutationScope,
		name: RecoveryStep,
		run: (permit: ArtifactPermit) => Promise<T>,
	): Promise<
		| { status: "ok"; value: T }
		| { status: "rejected"; reason: string }
		| { status: "unknown" }
	> {
		let permit: ArtifactPermit;
		try {
			permit = ledger.admit(scope, name);
		} catch (error) {
			if (error instanceof RecoveryDenied)
				return { status: "rejected", reason: error.reason };
			throw error;
		}
		try {
			// Authority is read again after admission: a newer executor generation
			// or a lost executor denies the step before it reaches the workspace.
			authority = await host.authority();
			ledger.check(permit);
			const value = await run(permit);
			ledger.settle(permit, "completed");
			return { status: "ok", value };
		} catch (error) {
			if (error instanceof RecoveryDenied) {
				ledger.settle(permit, "failed");
				return { status: "rejected", reason: error.reason };
			}
			if (error instanceof ArtifactStepRejected) {
				ledger.settle(permit, "failed");
				return { status: "rejected", reason: error.reason };
			}
			if (RECOVERY_STEPS[name] === "mutation") {
				ledger.settle(permit, "unknown");
				return { status: "unknown" };
			}
			ledger.settle(permit, "failed");
			return { status: "rejected", reason: "execution_failed" };
		}
	}

	function admissionDenial(
		mutation: boolean,
	): WorkspaceActionResultV1 | undefined {
		const admission = host.admission();
		if (admission !== "open") return { status: "denied", reason: admission };
		if (host.blocked() || preview().state === "unknown")
			return { status: "denied", reason: "blocked" };
		if (mutation && overdue())
			return { status: "denied", reason: "backup_overdue" };
		return undefined;
	}

	async function gitStatus(): Promise<WorkspaceActionResultV1> {
		const denied = admissionDenial(false);
		if (denied) return denied;
		const scope = await acquire();
		if ("status" in scope) return scope;
		try {
			const result = await step(scope, "git_status", (permit) =>
				deps.execution.gitStatus(permit, { branch: deps.branch }),
			);
			if (result.status !== "ok")
				return result.status === "unknown"
					? result
					: { status: "rejected", reason: result.reason };
			return { status: "git_status", ...result.value };
		} finally {
			ledger.release(scope);
		}
	}

	async function gitCommit(message: string): Promise<WorkspaceActionResultV1> {
		const denied = admissionDenial(true);
		if (denied) return denied;
		const scope = await acquire();
		if ("status" in scope) return scope;
		try {
			// Persisted before dispatch: a lost commit still counts as unbacked.
			noteMutation();
			const result = await step(scope, "git_commit", (permit) =>
				deps.execution.gitCommit(permit, { branch: deps.branch, message }),
			);
			if (result.status !== "ok")
				return result.status === "unknown"
					? result
					: { status: "rejected", reason: result.reason };
			return result.value.committed
				? { status: "committed", head: result.value.head }
				: { status: "nothing_to_commit", head: result.value.head };
		} finally {
			ledger.release(scope);
			await host.wake(deps.now());
		}
	}

	/**
	 * Starts preview in a held scope; a cold workspace first gets committed
	 * files. Starting a process is not a file change, so it never sets or moves
	 * the backup deadline. A user start refused for an overdue backup is kept
	 * as demand and runs once the backup commits.
	 */
	async function startPreview(user: boolean): Promise<WorkspaceActionResultV1> {
		const current = preview();
		if (current.state === "running")
			return { status: "preview_running", generation: current.generation };
		const denied = admissionDenial(true);
		if (denied) {
			if (
				user &&
				denied.status === "denied" &&
				denied.reason === "backup_overdue"
			)
				sql.exec("UPDATE workspace_preview SET demand = 1 WHERE id = 1");
			return denied;
		}
		let scope = await acquire();
		if ("status" in scope) return scope;
		let present: Awaited<ReturnType<typeof step<boolean>>>;
		try {
			present = await step(scope, "present", (permit) =>
				deps.execution.present(permit),
			);
		} finally {
			ledger.release(scope);
		}
		if (present.status !== "ok")
			return { status: "rejected", reason: "present_failed" };
		if (!present.value) {
			// Unbacked changes put the conversation ahead of every pair; restoring
			// files alone would hide that loss. Only a paired restore may.
			if (backup().unbacked_since !== null)
				return { status: "preview_unavailable" };
			const restored = await deps.publisher().restoreFiles();
			if (restored.status === "unavailable")
				return { status: "preview_unavailable" };
			if (restored.status === "deferred")
				return { status: "denied", reason: "busy" };
			scope = await acquire();
			if ("status" in scope) return scope;
		} else {
			scope = await acquire();
			if ("status" in scope) return scope;
		}
		try {
			// Rechecked under the held scope: the awaits above can race another
			// start, a restore fence or the backup deadline.
			const late = admissionDenial(true);
			if (late) {
				if (
					user &&
					late.status === "denied" &&
					late.reason === "backup_overdue"
				)
					sql.exec("UPDATE workspace_preview SET demand = 1 WHERE id = 1");
				return late;
			}
			const again = preview();
			if (again.state === "running")
				return { status: "preview_running", generation: again.generation };
			const result = await step(scope, "preview_start", (permit) =>
				deps.execution.previewStart(permit, { port: WORKSPACE_PREVIEW_PORT }),
			);
			if (result.status === "unknown") {
				sql.exec("UPDATE workspace_preview SET state = 'unknown' WHERE id = 1");
				return result;
			}
			if (result.status === "rejected")
				return { status: "rejected", reason: result.reason };
			sql.exec(
				"UPDATE workspace_preview SET state = 'running', generation = generation + 1, demand = 0, stopped_for_backup = 0 WHERE id = 1",
			);
			return { status: "preview_running", generation: preview().generation };
		} finally {
			ledger.release(scope);
		}
	}

	/**
	 * Stops preview and revokes every URL of its generation. Only termination
	 * evidence marks it stopped; anything else leaves it unknown, which blocks
	 * capture instead of publishing a falsely consistent pair.
	 */
	async function stopPreview(
		reason: "user" | "backup" | "restore" | "archive",
	): Promise<WorkspaceActionResultV1> {
		const current = preview();
		if (current.state === "stopped")
			return { status: "preview_stopped", generation: current.generation };
		if (current.state === "unknown")
			return { status: "denied", reason: "blocked" };
		const scope = await acquire();
		if ("status" in scope) return scope;
		try {
			const again = preview();
			if (again.state !== "running")
				return again.state === "stopped"
					? { status: "preview_stopped", generation: again.generation }
					: { status: "denied", reason: "blocked" };
			const result = await step(scope, "preview_stop", (permit) =>
				deps.execution.previewStop(permit),
			);
			await deps.fault?.("after-preview-stop");
			if (result.status === "ok" && result.value.terminated) {
				sql.exec(
					"UPDATE workspace_preview SET state = 'stopped', generation = generation + 1, stopped_for_backup = ?, demand = 0 WHERE id = 1",
					reason === "backup" ? 1 : 0,
				);
				return { status: "preview_stopped", generation: preview().generation };
			}
			if (result.status === "rejected")
				return { status: "rejected", reason: result.reason };
			sql.exec("UPDATE workspace_preview SET state = 'unknown' WHERE id = 1");
			return { status: "unknown" };
		} finally {
			ledger.release(scope);
		}
	}

	/**
	 * Restart after a backup is its own action, never part of the retry. A
	 * refused user start stays pending until a restart succeeds.
	 */
	async function restart(): Promise<number | null> {
		const after = preview();
		const recent =
			after.stopped_for_backup === 1 &&
			after.last_traffic !== null &&
			deps.now() - after.last_traffic <= RECENT_TRAFFIC_MS;
		sql.exec(
			"UPDATE workspace_preview SET stopped_for_backup = 0 WHERE id = 1",
		);
		if (after.demand === 1 || recent) {
			const restarted = await startPreview(false);
			if (restarted.status === "denied" && after.demand === 1)
				return restarted.reason === "busy"
					? deps.now() + RETRY_MS
					: backup().deadline;
		}
		sql.exec("UPDATE workspace_preview SET demand = 0 WHERE id = 1");
		return backup().deadline;
	}

	return {
		async act(action: WorkspaceActionV1): Promise<WorkspaceActionResultV1> {
			switch (action.kind) {
				case "git_status":
					return gitStatus();
				case "git_commit":
					return gitCommit(action.message);
				case "preview_start":
					return startPreview(true);
				case "preview_stop":
					return stopPreview("user");
			}
		},
		noteMutation,
		/** New mutations wait for a committed pair once the deadline passes. */
		mutationAllowed: () => !overdue(),
		/** Publication treats a running or uncertain preview as an unsettled writer. */
		async writers() {
			return { settled: preview().state === "stopped" };
		},
		/** A stopped preview must not keep a URL; a running one checks its generation. */
		previewAuthority(value: number) {
			const row = preview();
			return row.state === "running" && row.generation === value;
		},
		traffic() {
			sql.exec(
				"UPDATE workspace_preview SET last_traffic = ? WHERE id = 1",
				deps.now(),
			);
		},
		/** Restored files equal a committed pair, so nothing is unbacked. */
		restored() {
			sql.exec(
				"UPDATE workspace_backup SET unbacked_since = NULL, deadline = NULL WHERE id = 1",
			);
		},
		/** Restore needs settled writers; it stops preview without a restart. */
		async quiesceForRestore(): Promise<boolean> {
			const result = await stopPreview("restore");
			return result.status === "preview_stopped";
		},
		/**
		 * Archive needs preview stopped with termination evidence, no unknown
		 * outcome and a final pair that holds every change; `publish` asks for
		 * a new pair even when no file changed, such as after later answers.
		 */
		async finalizeForArchive(
			publish: boolean,
		): Promise<
			| { status: "final" }
			| { status: "retry" }
			| { status: "blocked"; reason: "preview_unknown" | "outcome_unknown" }
		> {
			if (preview().state === "unknown")
				return { status: "blocked", reason: "preview_unknown" };
			if (unresolved() || host.blocked())
				return { status: "blocked", reason: "outcome_unknown" };
			const stopped = await stopPreview("archive");
			if (stopped.status === "unknown")
				return { status: "blocked", reason: "preview_unknown" };
			if (stopped.status !== "preview_stopped") return { status: "retry" };
			if (!host.quiescent()) return { status: "retry" };
			if (publish || backup().unbacked_since !== null) {
				const published = await deps.publisher().publishBoundary();
				if (published.status !== "published") return { status: "retry" };
				sql.exec(
					"UPDATE workspace_backup SET unbacked_since = NULL, deadline = NULL WHERE id = 1",
				);
			}
			return { status: "final" };
		},
		/**
		 * One backup step from the host alarm. Returns when to run again, or
		 * null when nothing is pending or a block needs review.
		 */
		async tick(): Promise<number | null> {
			const due = backup();
			if (due.unbacked_since === null || due.deadline === null)
				return preview().demand === 1 ? restart() : null;
			const now = deps.now();
			const state = preview();
			// An unknown outcome needs review; retrying cannot publish.
			if (state.state === "unknown" || unresolved()) return null;
			if (state.state === "running" && now < due.deadline) return due.deadline;
			if (!host.quiescent()) return now + RETRY_MS;
			if (state.state === "running") {
				const stopped = await stopPreview("backup");
				if (stopped.status !== "preview_stopped")
					return stopped.status === "unknown" ? null : now + RETRY_MS;
			}
			const published = await deps.publisher().publishBoundary();
			if (published.status !== "published") return deps.now() + RETRY_MS;
			sql.exec(
				"UPDATE workspace_backup SET unbacked_since = NULL, deadline = NULL WHERE id = 1",
			);
			return restart();
		},
	};
}

export type WorkspaceController = ReturnType<typeof createWorkspaceController>;
