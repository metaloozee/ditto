import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq } from "drizzle-orm";
import { createDb } from "#/db";
import { agentRuns, workspaceSessions } from "#/db/schema";
import { createAuth } from "#/lib/auth";
import { isActiveAgentRunStatus } from "#/lib/workspace-policy";

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

				const [latestRun] = await db
					.select({
						flueAgentName: agentRuns.flueAgentName,
						isMutating: agentRuns.isMutating,
						status: agentRuns.status,
					})
					.from(agentRuns)
					.where(
						and(
							eq(agentRuns.sessionId, sessionId),
							eq(agentRuns.userId, authSession.user.id),
						),
					)
					.orderBy(desc(agentRuns.createdAt))
					.limit(1);

				if (
					latestRun &&
					isActiveAgentRunStatus(latestRun.status) &&
					(latestRun.flueAgentName || !latestRun.isMutating)
				) {
					const bridgeNamespace = env.FlueRunBridge as DurableObjectNamespace;
					const bridgeId = bridgeNamespace.idFromName(sessionId);
					const bridge = bridgeNamespace.get(bridgeId) as {
						fetch(request: Request): Promise<Response>;
					};

					return await bridge.fetch(request);
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
