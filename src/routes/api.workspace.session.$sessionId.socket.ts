import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { createDb } from "#/db";
import { workspaceSessions } from "#/db/schema";
import { createAuth } from "#/lib/auth";

export const Route = createFileRoute(
	"/api/workspace/session/$sessionId/socket",
)({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const sessionId = (params as { sessionId: string }).sessionId;
				const authSession = await createAuth(env).api.getSession({
					headers: request.headers,
				});

				if (!authSession?.user) {
					return new Response("Unauthorized", { status: 401 });
				}

				const db = createDb(env);
				const [session] = await db
					.select()
					.from(workspaceSessions)
					.where(
						and(
							eq(workspaceSessions.id, sessionId),
							eq(workspaceSessions.userId, authSession.user.id),
						),
					)
					.limit(1);

				if (!session) {
					return new Response("Forbidden", { status: 403 });
				}

				const brokerNamespace =
					env.WorkspaceSessionBroker as DurableObjectNamespace;
				const brokerId = brokerNamespace.idFromName(sessionId);
				const broker = brokerNamespace.get(brokerId) as {
					fetch(request: Request): Promise<Response>;
				};

				return await broker.fetch(request);
			},
		},
	},
});
