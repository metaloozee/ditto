// The Workspace object's RPC surface, kept free of Worker imports so the browser-side
// program can type its binding without loading the class.

export interface ChiefOfStaff {
	id: string;
	name: "Ditto";
}

export type OpenedWorkspace =
	| {
			workspaceId: string;
			chiefOfStaff: ChiefOfStaff;
			computer: "stopped" | "running";
	  }
	| { refused: "not the owner" };

/** What the shared computer's instance was started with. */
export interface ComputerPolicy {
	workspaceId: string;
	/** The approved exact hosts; every other host is denied. */
	hosts: string[];
}

/** Why private sessions (restored logins, a signed-in computer) are unavailable. */
export type PrivateSessionsRefusal =
	/** No instance runs. */
	| "stopped"
	/** The instance runs, but no isolation check is recorded for this start yet. */
	| "unchecked"
	/** The instance did not report its isolation. */
	| "report-missing"
	/** The instance's isolation report could not be read. */
	| "report-unreadable"
	/** The instance runs under another workspace ID or list than it was started with. */
	| "policy-mismatch"
	/** Something besides the filter has a route out. */
	| "fence-absent"
	/** The approved list changed after the start; the instance still enforces the old one. */
	| "list-changed";

export type PrivateSessions =
	| { available: true }
	| { available: false; reason: PrivateSessionsRefusal; detail: string };

/** What the Workspace object recorded about the instance's isolation, once per start. */
export interface IsolationCheck {
	checkedAt: string;
	/** The instance reported this workspace's ID and the list it was started with. */
	policy: boolean;
	/** The instance reported that only the filter has a route out. */
	fence: boolean;
	/** Why `policy` or `fence` is false; null when both were verified. */
	problem: { reason: PrivateSessionsRefusal; detail: string } | null;
}

export type ComputerStatus =
	| { computer: "stopped"; privateSessions: PrivateSessions }
	| {
			computer: "running";
			/** The policy the instance started under, which a later list change does not alter. */
			policy: ComputerPolicy | null;
			/** When the instance is destroyed regardless, as scheduled at start. */
			deadline: string | null;
			/** Null until the start's check is recorded. */
			isolation: IsolationCheck | null;
			privateSessions: PrivateSessions;
	  };

/** A bot in a workspace's membership. */
export interface Member {
	id: string;
	name: string;
}

/** Test stage only: faults the object honours when TEST_HOOKS is on. */
export interface OpenFaults {
	failProjection?: boolean;
}

export interface WorkspaceRpc {
	open(workspaceId: string, accountId: string, faults?: OpenFaults): Promise<OpenedWorkspace>;
	members(): Promise<Member[]>;
	reconcileBotList(): Promise<void>;
	evict(): void;
}
