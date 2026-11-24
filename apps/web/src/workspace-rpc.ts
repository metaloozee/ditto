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

export interface WorkspaceRpc {
	open(workspaceId: string, accountId: string): Promise<OpenedWorkspace>;
	evict(): void;
}
