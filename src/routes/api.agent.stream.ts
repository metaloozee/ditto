import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createDb } from "#/db";
import {
	agentStreamBodySchema,
	executeAgentRun,
	prepareAgentRun,
} from "#/lib/agent-run-service";
import { encodeSseEvent } from "#/lib/agent-stream-protocol";
import { createAuth } from "#/lib/auth";

function jsonResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export const Route = createFileRoute("/api/agent/stream")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const auth = createAuth(env);
				const session = await auth.api.getSession({
					headers: request.headers,
				});

				if (!session?.user) {
					return jsonResponse({ error: "Unauthorized" }, 401);
				}

				let body: unknown;
				try {
					body = await request.json();
				} catch {
					return jsonResponse({ error: "Invalid JSON body." }, 400);
				}

				const parsed = agentStreamBodySchema.safeParse(body);
				if (!parsed.success) {
					return jsonResponse(
						{ error: "Invalid request.", issues: parsed.error.issues },
						400,
					);
				}

				const db = createDb(env);
				const prepared = await prepareAgentRun({
					db,
					env,
					userId: session.user.id,
					input: parsed.data,
				});

				if (prepared.kind === "error") {
					return jsonResponse(prepared.body, prepared.status);
				}

				const encoder = new TextEncoder();
				const readable = new ReadableStream<Uint8Array>({
					async start(controller) {
						const enqueue = (event: string, data: unknown) => {
							controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
						};

						try {
							await executeAgentRun({
								context: prepared.context,
								emit: ({ event, data }) => {
									enqueue(event, data);
								},
							});
						} finally {
							controller.close();
						}
					},
				});

				return new Response(readable, {
					headers: {
						"Content-Type": "text/event-stream; charset=utf-8",
						"Cache-Control": "no-cache, no-transform",
						Connection: "keep-alive",
					},
				});
			},
		},
	},
});
