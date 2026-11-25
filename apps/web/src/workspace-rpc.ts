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

export type ComputerStatus =
	| { computer: "stopped" }
	| {
			computer: "running";
			/** The policy the instance started under, which a later list change does not alter. */
			policy: ComputerPolicy | null;
			/** When the instance is destroyed regardless, as scheduled at start. */
			deadline: string | null;
	  };

export interface WorkspaceRpc {
	open(workspaceId: string, accountId: string): Promise<OpenedWorkspace>;
	evict(): void;
}
