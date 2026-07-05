import type {
	ProjectCoordinatorLease,
	ProjectCoordinatorReadOnlyRun,
	ProjectCoordinatorSnapshotState,
	ProjectCoordinatorState,
	ProjectCoordinatorTerminalStatus,
} from "./project-coordinator";

const LEGACY_EXPIRED_AT = "1970-01-01T00:00:00.000Z";

export type CoordinatorMetaRow = {
	project_id: string | null;
	next_fencing_token: number;
};

export type MutationLeaseRow = {
	run_id: string;
	session_id: string;
	user_id: string;
	fencing_token: number;
	admitted_at: string;
	expires_at?: string | null;
};

export type ReadOnlyRunRow = {
	run_id: string;
	session_id: string;
	user_id: string;
	admitted_at: string;
};

export type LastTerminalRow = {
	run_id: string;
	status: string;
	observed_at: string;
};

export type SnapshotStateRow = {
	latest_snapshot_id: string | null;
	restoring: number;
};

export type CoordinatorSqlRows = {
	meta: CoordinatorMetaRow | null;
	lease: MutationLeaseRow | null;
	readOnlyRuns: ReadOnlyRunRow[];
	lastTerminal: LastTerminalRow | null;
	snapshotState: SnapshotStateRow | null;
};

function parseTerminalStatus(value: string): ProjectCoordinatorTerminalStatus {
	if (value === "completed" || value === "failed" || value === "canceled") {
		return value;
	}
	throw new Error(`Invalid terminal status in coordinator storage: ${value}`);
}

export function coordinatorRowsToState(
	rows: CoordinatorSqlRows,
): ProjectCoordinatorState {
	const projectId = rows.meta?.project_id ?? undefined;
	const nextFencingToken = rows.meta?.next_fencing_token ?? 1;

	let mutationLease: ProjectCoordinatorLease | null = null;
	if (rows.lease && projectId) {
		mutationLease = {
			projectId,
			runId: rows.lease.run_id,
			sessionId: rows.lease.session_id,
			userId: rows.lease.user_id,
			mode: "mutating",
			capabilities: "mutating",
			fencingToken: rows.lease.fencing_token,
			admittedAt: rows.lease.admitted_at,
			expiresAt: rows.lease.expires_at ?? LEGACY_EXPIRED_AT,
		};
	}

	const activeReadOnlyRuns: ProjectCoordinatorReadOnlyRun[] =
		rows.readOnlyRuns.map((row) => ({
			projectId: projectId ?? "",
			runId: row.run_id,
			sessionId: row.session_id,
			userId: row.user_id,
			mode: "read_only",
			capabilities: "read_only",
			admittedAt: row.admitted_at,
		}));

	const lastTerminal = rows.lastTerminal
		? {
				runId: rows.lastTerminal.run_id,
				status: parseTerminalStatus(rows.lastTerminal.status),
				observedAt: rows.lastTerminal.observed_at,
			}
		: undefined;

	const snapshot: ProjectCoordinatorSnapshotState = rows.snapshotState
		? {
				latestSnapshotId: rows.snapshotState.latest_snapshot_id,
				restoring: rows.snapshotState.restoring === 1,
			}
		: { latestSnapshotId: null, restoring: false };

	return {
		projectId,
		mutationLease,
		activeReadOnlyRuns,
		lastTerminal,
		nextFencingToken,
		snapshot,
	};
}

export function coordinatorStateToRows(
	state: ProjectCoordinatorState,
): CoordinatorSqlRows {
	const meta: CoordinatorMetaRow = {
		project_id: state.projectId ?? null,
		next_fencing_token: state.nextFencingToken,
	};

	const lease: MutationLeaseRow | null = state.mutationLease
		? {
				run_id: state.mutationLease.runId,
				session_id: state.mutationLease.sessionId,
				user_id: state.mutationLease.userId,
				fencing_token: state.mutationLease.fencingToken,
				admitted_at: state.mutationLease.admittedAt,
				expires_at: state.mutationLease.expiresAt,
			}
		: null;

	const readOnlyRuns: ReadOnlyRunRow[] = state.activeReadOnlyRuns.map(
		(run) => ({
			run_id: run.runId,
			session_id: run.sessionId,
			user_id: run.userId,
			admitted_at: run.admittedAt,
		}),
	);

	const lastTerminal: LastTerminalRow | null = state.lastTerminal
		? {
				run_id: state.lastTerminal.runId,
				status: state.lastTerminal.status,
				observed_at: state.lastTerminal.observedAt,
			}
		: null;

	const snapshotState: SnapshotStateRow = {
		latest_snapshot_id: state.snapshot.latestSnapshotId,
		restoring: state.snapshot.restoring ? 1 : 0,
	};

	return { meta, lease, readOnlyRuns, lastTerminal, snapshotState };
}
