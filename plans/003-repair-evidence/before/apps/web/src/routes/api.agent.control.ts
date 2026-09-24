import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createDb } from "#/db";
import {
	agentControlBodySchema,
	controlAgentRun,
} from "#/lib/agent-control-service";
import { createAuth } from "#/lib/auth";
import {
	handleSessionCommandRequest,
	isVersionedAgentCommand,
} from "#/lib/session-command";
import {
	createSessionRuntimeClient,
	SESSION_RUNTIME_PROTOCOL_VERSION,
} from "#/lib/session-runtime-client";

function jsonResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export const Route = createFileRoute("/api/agent/control")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const session = await createAuth(env).api.getSession({
					headers: request.headers,
				});
				if (!session?.user) return jsonResponse({ error: "Unauthorized" }, 401);

				let body: unknown;
				try {
					body = await request.json();
				} catch {
					return jsonResponse({ error: "Invalid JSON body." }, 400);
				}
				const db = createDb(env);
				if (isVersionedAgentCommand(body)) {
					const result = await handleSessionCommandRequest({
						db,
						runtime: createSessionRuntimeClient({
							modelConfiguration: async () => ({
								configured: Boolean(env.OPENCODE_API_KEY?.trim()),
								protocolVersion: SESSION_RUNTIME_PROTOCOL_VERSION,
							}),
							deliver: async () => {
								throw new Error("runtime_unavailable");
							},
							control: async () => {
								throw new Error("runtime_unavailable");
							},
						}),
						authenticatedUserId: session.user.id,
						body,
					});
					return jsonResponse(result.body, result.status);
				}
				const parsed = agentControlBodySchema.safeParse(body);
				if (!parsed.success) {
					return jsonResponse(
						{ error: "Invalid request.", issues: parsed.error.issues },
						400,
					);
				}

				const result = await controlAgentRun({
					db,
					env,
					userId: session.user.id,
					input: parsed.data,
				});
				return jsonResponse(result.body, result.status);
			},
		},
	},
});
