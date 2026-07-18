import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createDb } from "#/db";
import { encodeSseEvent } from "#/lib/agent-stream-protocol";
import { createAuth } from "#/lib/auth";
import {
	providerAuthStreamBodySchema,
	streamProviderAuth,
} from "#/lib/provider-auth-service";

function jsonResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export const Route = createFileRoute("/api/provider-auth/stream")({
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
				const parsed = providerAuthStreamBodySchema.safeParse(body);
				if (!parsed.success) {
					return jsonResponse(
						{ error: "Invalid request.", issues: parsed.error.issues },
						400,
					);
				}

				const db = createDb(env);
				const encoder = new TextEncoder();
				const readable = new ReadableStream<Uint8Array>({
					async start(controller) {
						const enqueue = (event: string, data: unknown) => {
							try {
								controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
							} catch {
								// client disconnected
							}
						};
						try {
							await streamProviderAuth({
								db,
								env,
								userId: session.user.id,
								input: parsed.data,
								signal: request.signal,
								emit: ({ event, data }) => {
									enqueue(event, data);
								},
							});
						} finally {
							try {
								controller.close();
							} catch {
								// already closed
							}
						}
					},
					cancel() {
						// request.signal aborts via fetch cancel; streamProviderAuth cleans up.
					},
				});

				return new Response(readable, {
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
						Connection: "keep-alive",
					},
				});
			},
		},
	},
});
