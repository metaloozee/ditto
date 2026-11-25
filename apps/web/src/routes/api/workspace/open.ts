import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/open")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const { env } = await import("cloudflare:workers");
				const { auth } = await import("#/lib/auth.server.ts");
				const { personalWorkspaceId } = await import("#/lib/workspace-gateway.server.ts");
				const { openPersonalWorkspace } = await import("#/lib/workspace.server.ts");

				if (
					env.TEST_HOOKS === "on" &&
					request.headers.get("x-test-interrupt") === "after-mapping"
				) {
					const session = await auth.api.getSession({ headers: request.headers });
					if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
					return Response.json(
						{ interrupted: await personalWorkspaceId(session.user.id) },
						{ status: 503 },
					);
				}

				const failProjection =
					env.TEST_HOOKS === "on" && request.headers.get("x-test-fault") === "projection";
				const opened = await openPersonalWorkspace(request.headers, { failProjection });
				if (opened instanceof Response) return opened;
				if ("refused" in opened) return Response.json({ error: opened.refused }, { status: 403 });
				return Response.json(opened);
			},
		},
	},
});
