import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/$workspaceId/bots")({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const { auth } = await import("#/lib/auth.server.ts");
				const { botList, ownsWorkspace } = await import("#/lib/workspace.server.ts");
				const session = await auth.api.getSession({ headers: request.headers });
				if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
				// A foreign or guessed ID looks the same as one that does not exist.
				if (!(await ownsWorkspace(session.user.id, params.workspaceId))) {
					return Response.json({ error: "No such workspace" }, { status: 404 });
				}
				return Response.json({ bots: await botList(params.workspaceId) });
			},
		},
	},
});
