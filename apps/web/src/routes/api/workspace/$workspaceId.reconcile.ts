import { createFileRoute } from "@tanstack/react-router";

/** Rebuilds the workspace's D1 bot list from the Workspace object's membership, on demand. */
export const Route = createFileRoute("/api/workspace/$workspaceId/reconcile")({
	server: {
		handlers: {
			POST: async ({ request, params }) => {
				const { env } = await import("cloudflare:workers");
				const { auth } = await import("#/lib/auth.server.ts");
				const { ownsWorkspace } = await import("#/lib/workspace.server.ts");
				const session = await auth.api.getSession({ headers: request.headers });
				if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
				if (!(await ownsWorkspace(session.user.id, params.workspaceId))) {
					return Response.json({ error: "No such workspace" }, { status: 404 });
				}
				await env.WORKSPACE.getByName(params.workspaceId).reconcileBotList();
				return new Response(null, { status: 204 });
			},
		},
	},
});
