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
