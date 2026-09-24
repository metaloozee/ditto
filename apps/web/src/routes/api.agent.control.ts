import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createDb } from "#/db";
import {
	agentControlBodySchema,
	controlAgentRun,
} from "#/lib/agent-control-service";
import { createAuth } from "#/lib/auth";
import {
	classifyAgentRequestBody,
	handleSessionCommandRequest,
	readBoundedAgentRequestText,
	SessionCommandError,
} from "#/lib/session-command";
import {
	createSessionRuntimeClient,
	isTrustedAdmissionEligible,
	resolveSessionAdmissionHooks,
	resolveSessionRuntimeTransport,
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

				const classified = classifyAgentRequestBody(raw);
				if (classified.mode === "error") {
					return jsonResponse(
						classified.error?.body,
						classified.error?.status ?? 400,
					);
				}

				const db = createDb(env);
				if (classified.mode === "versioned") {
					if (!isTrustedAdmissionEligible()) {
						return jsonResponse(
							{
								error: "Trusted command admission is not enabled.",
								code: "trusted_admission_ineligible",
								category: "upgrade_recovery",
							},
							409,
						);
					}
					const admission = resolveSessionAdmissionHooks();
					const result = await handleSessionCommandRequest({
						db,
						runtime: createSessionRuntimeClient(
							resolveSessionRuntimeTransport(),
						),
						authenticatedUserId: session.user.id,
						body: raw,
						now: admission.now,
						createId: admission.createId,
					});
					return jsonResponse(result.body, result.status);
				}
				const parsed = agentControlBodySchema.safeParse(classified.decoded);
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
