import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import type { OpenedWorkspace } from "#/workspace-rpc.ts";

export type Workspace = Exclude<OpenedWorkspace, { refused: string }>;

/** Opens the signed-in owner's personal workspace, provisioning it on first use. */
export const openWorkspace = createServerFn({ method: "POST" }).handler(
	async (): Promise<Workspace> => {
		const { auth } = await import("./auth.server.ts");
		const { openPersonalWorkspace } = await import("./workspace.server.ts");
		const session = await auth.api.getSession({ headers: getRequestHeaders() });
		if (!session) throw new Error("Sign in first");
		const opened = await openPersonalWorkspace(session.user.id);
		if ("refused" in opened) throw new Error("This workspace belongs to another account");
		return opened;
	},
);
