import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/open")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const { openPersonalWorkspace } = await import("#/lib/workspace.server.ts");
				return openPersonalWorkspace(request);
			},
		},
	},
});
