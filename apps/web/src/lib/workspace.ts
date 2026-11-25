import { redirect } from "@tanstack/react-router";
import { createIsomorphicFn, createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeaders } from "@tanstack/react-start/server";

import type { OpenedWorkspace } from "#/workspace-rpc.ts";

export type Workspace = Exclude<OpenedWorkspace, { refused: string }>;

/** Opens the signed-in owner's personal workspace, provisioning it on first use. */
export const openWorkspace = createServerFn({ method: "POST" }).handler(
	async (): Promise<Workspace> => {
		const { env } = await import("cloudflare:workers");
		const { auth } = await import("./auth.server.ts");
		const { openPersonalWorkspace } = await import("./workspace.server.ts");
		if (env.TEST_HOOKS === "on" && getCookie("test-fail-open")) {
			throw new Error("The test stage failed this open");
		}
		const session = await auth.api.getSession({ headers: getRequestHeaders() });
		if (!session) throw redirect({ to: "/sign-in" });
		const opened = await openPersonalWorkspace(session.user.id);
		if ("refused" in opened) throw new Error("This workspace belongs to another account");
		return opened;
	},
);

/**
 * Whether the owner pinned the sidebar open, from the cookie the sidebar writes. Read
 * during SSR too, so a hidden sidebar never flashes in. Pinned until they unpin it.
 */
export const getSidebarPinned = createIsomorphicFn()
	.server(() => getCookie("sidebar_state") !== "false")
	.client(() => !document.cookie.split("; ").includes("sidebar_state=false"));
