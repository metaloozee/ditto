import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/$workspaceId/bots")({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const { admit } = await import("#/lib/workspace-gateway.server.ts");
				const { botList } = await import("#/lib/workspace.server.ts");
				const admitted = await admit(request.headers, params.workspaceId);
				if (admitted instanceof Response) return admitted;
				return Response.json({ bots: await botList(admitted.workspaceId) });
			},
		},
	},
});
