import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createDb } from "#/db";
import {
	AgentGitHttpError,
	agentGitBodySchema,
	dispatchAgentGitAction,
	resolveAgentGitContext,
} from "#/lib/agent-git-handler";
import { verifyAgentGitJwt } from "#/lib/agent-git-jwt";

function jsonResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function parseBearerToken(authorization: string | null): string | null {
	if (!authorization) {
		return null;
	}
	const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
	return match?.[1]?.trim() ?? null;
}

export const Route = createFileRoute("/api/agent/git")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const token = parseBearerToken(request.headers.get("authorization"));
				if (!token) {
					return jsonResponse({ error: "Unauthorized" }, 401);
				}

				const verified = await verifyAgentGitJwt(token, env.BETTER_AUTH_SECRET);
				if (!verified.ok) {
					return jsonResponse({ error: "Unauthorized" }, 401);
				}

				let body: unknown;
				try {
					body = await request.json();
				} catch {
					return jsonResponse({ error: "Invalid JSON body." }, 400);
				}

				const parsed = agentGitBodySchema.safeParse(body);
				if (!parsed.success) {
					return jsonResponse(
						{ error: "Invalid request.", issues: parsed.error.issues },
						400,
					);
				}

				const db = createDb(env);

				try {
					const resolved = await resolveAgentGitContext({
						db,
						env,
						claims: verified.claims,
					});
					const result = await dispatchAgentGitAction({
						env,
						resolved,
						body: parsed.data,
					});
					return jsonResponse({ ok: true, result }, 200);
				} catch (error) {
					if (error instanceof AgentGitHttpError) {
						return jsonResponse({ error: error.message }, error.status);
					}
					const message =
						error instanceof Error
							? error.message
							: "Agent git request failed.";
					return jsonResponse({ error: message }, 500);
				}
			},
		},
	},
});
