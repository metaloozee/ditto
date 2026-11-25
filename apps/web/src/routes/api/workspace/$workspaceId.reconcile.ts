import { createFileRoute } from "@tanstack/react-router";

/** Rebuilds the workspace's D1 bot list from the Workspace object's membership, on demand. */
export const Route = createFileRoute("/api/workspace/$workspaceId/reconcile")({
	server: {
		handlers: {
			POST: async ({ request, params }) => {
				const { admit } = await import("#/lib/workspace-gateway.server.ts");
				const admitted = await admit(request.headers, params.workspaceId);
				if (admitted instanceof Response) return admitted;
				await admitted.workspace.reconcileBotList();
				return new Response(null, { status: 204 });
			},
		},
	},
});
