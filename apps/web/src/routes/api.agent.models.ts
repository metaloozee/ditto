import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createAuth } from "#/lib/auth";
import {
	handleCandidateModelsRequest,
	readBoundedAgentRequestText,
	SessionCommandError,
} from "#/lib/session-command";
import { resolveCandidateProductCommands } from "#/lib/session-runtime-client";

function jsonResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export const Route = createFileRoute("/api/agent/models")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const session = await createAuth(env).api.getSession({
					headers: request.headers,
				});
				if (!session?.user) return jsonResponse({ error: "Unauthorized" }, 401);

				let raw: string;
				try {
					raw = await readBoundedAgentRequestText(request);
				} catch (error) {
					if (error instanceof SessionCommandError) {
						return jsonResponse(
							{ error: error.message, code: error.code },
							error.status,
						);
					}
					throw error;
				}

				const result = await handleCandidateModelsRequest({
					service: resolveCandidateProductCommands(),
					authenticatedUserId: session.user.id,
					body: raw,
				});
				return jsonResponse(result.body, result.status);
			},
		},
	},
});
