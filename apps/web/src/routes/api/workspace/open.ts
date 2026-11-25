import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/open")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const { env } = await import("cloudflare:workers");
				const { auth } = await import("#/lib/auth.server.ts");
				const { openPersonalWorkspace, personalWorkspaceId } =
					await import("#/lib/workspace.server.ts");
				const session = await auth.api.getSession({ headers: request.headers });
				if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
				const accountId = session.user.id;

				if (
					env.TEST_HOOKS === "on" &&
					request.headers.get("x-test-interrupt") === "after-mapping"
				) {
					return Response.json(
						{ interrupted: await personalWorkspaceId(accountId) },
						{ status: 503 },
					);
				}

				const failProjection =
					env.TEST_HOOKS === "on" && request.headers.get("x-test-fault") === "projection";
				const opened = await openPersonalWorkspace(accountId, { failProjection });
				if ("refused" in opened) return Response.json({ error: opened.refused }, { status: 403 });
				return Response.json(opened);
			},
		},
	},
});
