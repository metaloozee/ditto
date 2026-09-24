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

				const parsed = agentStreamBodySchema.safeParse(classified.decoded);
				if (!parsed.success) {
					return jsonResponse(
						{ error: "Invalid request.", issues: parsed.error.issues },
						400,
					);
				}

				const prepared = await prepareAgentRun({
					db,
					env,
					userId: session.user.id,
					input: parsed.data,
					waitUntil: (promise) => {
						const runtime = globalThis as {
							waitUntil?: (p: Promise<unknown>) => void;
						};
						runtime.waitUntil?.(promise);
					},
				});

				if (prepared.kind === "error") {
					return jsonResponse(prepared.body, prepared.status);
				}

				if (prepared.kind === "queued") {
					return jsonResponse(
						{
							queued: true,
							workId: prepared.receipt.workId,
							queuePosition: prepared.receipt.queuePosition,
							queueExpiresAt: prepared.receipt.queueExpiresAt,
							sessionId: prepared.context.sessionId,
							userMessageId: prepared.context.userMessageId,
							assistantMessageId: prepared.context.assistantMessageId,
							createdSession: prepared.context.createdSession,
						},
						202,
					);
				}

				const encoder = new TextEncoder();
				type DeliveryState = "attached" | "detached" | "closed";
				let delivery: DeliveryState = "attached";
				const readable = new ReadableStream<Uint8Array>({
					async start(controller) {
						const deliver = (event: string, data: unknown) => {
							if (delivery !== "attached") {
								return;
							}
							try {
								controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
							} catch {
								delivery = "detached";
								console.warn("agent stream delivery failed");
							}
						};

						try {
							await executeAgentRun({
								context: prepared.context,
								emit: ({ event, data }) => {
									deliver(event, data);
								},
							});
						} catch {
							console.error("agent stream execution failed");
							if (delivery === "attached") {
								delivery = "closed";
								try {
									controller.error(new Error("agent stream execution failed"));
								} catch {
									console.warn("agent stream delivery failed");
								}
							}
						} finally {
							if (delivery === "attached") {
								delivery = "closed";
								try {
									controller.close();
								} catch {
									console.warn("agent stream delivery failed");
								}
							}
						}
					},
					cancel() {
						if (delivery === "attached") {
							delivery = "detached";
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
