import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/$workspaceId/files/$")({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const { serveFile } = await import("#/lib/workspace-files.server.ts");
				return serveFile(request, params.workspaceId);
			},
		},
	},
});
