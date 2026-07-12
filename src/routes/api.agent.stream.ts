import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { createDb } from "#/db";
import { messages, projects, workspaceSessions } from "#/db/schema";
import { isProjectCoderModelSpecifier } from "#/lib/agent-models";
import { runAgentInSandbox } from "#/lib/agent-run";
import {
	type AssistantMessagePart,
	appendAssistantTextDelta,
	applyAgentToolEventToParts,
	finalizeAssistantParts,
	partsToText,
	partsToTools,
	prepareAssistantMessageStorage,
	serializeAssistantPartsMinimalForStorage,
} from "#/lib/agent-stream-client";
import { encodeSseEvent } from "#/lib/agent-stream-protocol";
import { createAuth } from "#/lib/auth";
import { decryptEnvVars } from "#/lib/project-env-vars";
import {
	ensureProjectSandbox,
	persistProjectSandboxBackup,
} from "#/lib/project-sandbox";
import { redactSecrets } from "#/lib/secret-redaction";
import { ensureSessionWorktree } from "#/lib/session-worktree";
import { makeSessionTitleFromMessage } from "#/lib/workspace-policy";

const streamBodySchema = z.object({
	projectId: z.string().min(1),
	sessionId: z.string().min(1).optional(),
	message: z.string().trim().min(1),
	model: z.string().min(1).refine(isProjectCoderModelSpecifier, {
		message: "Invalid model.",
	}),
});

async function loadProjectForUser(options: {
	db: ReturnType<typeof createDb>;
	projectId: string;
	userId: string;
}) {
	const [project] = await options.db
		.select()
		.from(projects)
		.where(
			and(
				eq(projects.id, options.projectId),
				eq(projects.userId, options.userId),
			),
		)
		.limit(1);

	return project ?? null;
}

async function loadWorkspaceSession(options: {
	db: ReturnType<typeof createDb>;
	projectId: string;
	sessionId: string;
	userId: string;
}) {
	const [session] = await options.db
		.select()
		.from(workspaceSessions)
		.where(
			and(
				eq(workspaceSessions.id, options.sessionId),
				eq(workspaceSessions.projectId, options.projectId),
				eq(workspaceSessions.userId, options.userId),
			),
		)
		.limit(1);

	return session ?? null;
}

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

				const parsed = streamBodySchema.safeParse(body);
				if (!parsed.success) {
					return jsonResponse(
						{ error: "Invalid request.", issues: parsed.error.issues },
						400,
					);
				}

				const input = parsed.data;
				const db = createDb(env);
				const project = await loadProjectForUser({
					db,
					projectId: input.projectId,
					userId: session.user.id,
				});

				if (!project) {
					return jsonResponse({ error: "Project not found." }, 404);
				}

				if (project.status !== "ready" || !project.sandboxId) {
					return jsonResponse({ error: "Project sandbox is not ready." }, 409);
				}

				const envVars = await decryptEnvVars(
					project.envVars,
					env.BETTER_AUTH_SECRET,
				);

				let ensuredProject = project;
				let sandboxState: string;
				try {
					const ensured = await ensureProjectSandbox({
						db,
						env,
						project,
					});
					ensuredProject = ensured.project;
					sandboxState = ensured.state;
				} catch (error) {
					return jsonResponse(
						{
							error:
								error instanceof Error
									? error.message
									: "Failed to prepare sandbox.",
						},
						409,
					);
				}

				let sessionId = input.sessionId ?? null;
				let createdSession = false;
				let workspaceSession = sessionId
					? await loadWorkspaceSession({
							db,
							projectId: input.projectId,
							sessionId,
							userId: session.user.id,
						})
					: null;

				if (!workspaceSession) {
					sessionId = nanoid();
					const [createdRows] = await db.batch([
						db
							.insert(workspaceSessions)
							.values({
								id: sessionId,
								projectId: input.projectId,
								userId: session.user.id,
								title: makeSessionTitleFromMessage(input.message),
								status: "active",
							})
							.returning(),
					]);
					workspaceSession = createdRows?.[0] ?? null;
					createdSession = true;
				}

				if (!workspaceSession || !sessionId) {
					return jsonResponse(
						{ error: "Failed to create workspace session." },
						500,
					);
				}

				const userMessageId = nanoid();
				const assistantMessageId = nanoid();
				const [userRows, assistantRows] = await db.batch([
					db
						.insert(messages)
						.values({
							id: userMessageId,
							sessionId,
							projectId: input.projectId,
							userId: session.user.id,
							role: "user",
							content: input.message,
							model: input.model,
						})
						.returning(),
					db
						.insert(messages)
						.values({
							id: assistantMessageId,
							sessionId,
							projectId: input.projectId,
							userId: session.user.id,
							role: "assistant",
							content: "",
						})
						.returning(),
				]);

				if (!userRows?.[0] || !assistantRows?.[0]) {
					return jsonResponse({ error: "Failed to persist messages." }, 500);
				}

				const linkedGithubRepo = ensuredProject.githubRepo;
				const linkedInstallationId = ensuredProject.githubInstallationId;
				if (!linkedGithubRepo || linkedInstallationId == null) {
					return jsonResponse(
						{ error: "Project is not linked to a GitHub repository." },
						409,
					);
				}

				let sessionWorkspacePath: string;
				try {
					const ensuredWorktree = await ensureSessionWorktree({
						env,
						sandboxId: ensuredProject.sandboxId as string,
						sessionId,
						githubRepo: linkedGithubRepo,
						installationId: linkedInstallationId,
						existing: {
							branchName: workspaceSession.branchName,
							baseCommitSha: workspaceSession.baseCommitSha,
							workspacePath: workspaceSession.workspacePath,
						},
					});

					if (
						workspaceSession.branchName !== ensuredWorktree.branchName ||
						workspaceSession.workspacePath !== ensuredWorktree.workspacePath ||
						workspaceSession.baseCommitSha !== ensuredWorktree.baseCommitSha
					) {
						await db
							.update(workspaceSessions)
							.set({
								branchName: ensuredWorktree.branchName,
								baseCommitSha: ensuredWorktree.baseCommitSha,
								workspacePath: ensuredWorktree.workspacePath,
								updatedAt: sql`(unixepoch())`,
							})
							.where(eq(workspaceSessions.id, sessionId));
					}

					sessionWorkspacePath = ensuredWorktree.workspacePath;
				} catch (error) {
					return jsonResponse(
						{
							error:
								error instanceof Error
									? error.message
									: "Failed to prepare session worktree.",
						},
						409,
					);
				}

				const secretValues = [
					env.OPENCODE_API_KEY,
					...envVars.map((envVar) => envVar.value),
				].filter(
					(value): value is string =>
						typeof value === "string" && value.length > 0,
				);

				const encoder = new TextEncoder();
				const readable = new ReadableStream<Uint8Array>({
					async start(controller) {
						const enqueue = (event: string, data: unknown) => {
							controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
						};

						try {
							enqueue("meta", {
								sessionId,
								userMessageId,
								assistantMessageId,
								createdSession,
								sandboxState,
							});

							let assistantContent = "";
							let parts: AssistantMessagePart[] = [];

							const runResult = await runAgentInSandbox({
								env,
								sandboxId: ensuredProject.sandboxId as string,
								projectId: input.projectId,
								userId: session.user.id,
								conversationId: sessionId,
								cwd: sessionWorkspacePath,
								model: input.model,
								prompt: input.message,
								envVars,
								onRunnerMessage: async (msg) => {
									if (msg.kind === "agent_event") {
										enqueue("agent", { event: msg.event });
										const nextParts = applyAgentToolEventToParts(
											parts,
											msg.event,
										);
										if (nextParts) {
											parts = nextParts;
										}
									}
									if (msg.kind === "assistant_delta") {
										parts = appendAssistantTextDelta(parts, msg.delta);
										assistantContent = partsToText(parts);
										enqueue("delta", { delta: msg.delta });
									}
									if (msg.kind === "error") {
										enqueue("error", {
											message: redactSecrets(msg.message, secretValues),
										});
									}
								},
							});

							const textFromParts = partsToText(parts);
							if (textFromParts.trim().length > 0) {
								assistantContent = textFromParts;
							} else if (runResult.assistantText) {
								assistantContent = runResult.assistantText;
								parts = appendAssistantTextDelta(
									parts,
									runResult.assistantText,
								);
							} else {
								assistantContent = "";
							}

							// Belt-and-suspenders: never persist or emit unsanitized text even
							// if a future runner path bypasses agent-run redaction.
							assistantContent = redactSecrets(assistantContent, secretValues);

							const { toolsColumn } = prepareAssistantMessageStorage(parts);
							const fullParts = finalizeAssistantParts(parts);
							const fullTools = partsToTools(fullParts);

							try {
								await db
									.update(messages)
									.set({
										content: assistantContent,
										tools: toolsColumn,
									})
									.where(
										and(
											eq(messages.id, assistantMessageId),
											eq(messages.userId, session.user.id),
										),
									);
							} catch (error) {
								// Do not log raw payloads — tools/parts may historically have
								// contained secrets; only log the error itself.
								console.error(
									"Failed to persist assistant message tools; retrying with minimal serialization.",
									error instanceof Error ? error.message : error,
								);
								const fallbackTools =
									serializeAssistantPartsMinimalForStorage(parts);
								try {
									await db
										.update(messages)
										.set({
											content: assistantContent,
											tools: fallbackTools,
										})
										.where(
											and(
												eq(messages.id, assistantMessageId),
												eq(messages.userId, session.user.id),
											),
										);
								} catch (fallbackError) {
									console.error(
										"Minimal tools serialization also failed.",
										fallbackError instanceof Error
											? fallbackError.message
											: fallbackError,
									);
									throw fallbackError;
								}
							}

							let backupError: string | undefined;
							try {
								const backupResult = await persistProjectSandboxBackup({
									db,
									env,
									project: ensuredProject,
								});
								ensuredProject = backupResult.project;
								// Superseded candidates are success (no backupError).
							} catch (error) {
								backupError = redactSecrets(
									error instanceof Error
										? error.message
										: "Failed to persist backup metadata.",
									secretValues,
								);
							}

							enqueue("done", {
								ok: runResult.ok,
								assistantMessageId,
								content: assistantContent,
								...(fullTools.length > 0 ? { tools: fullTools } : {}),
								...(fullParts.length > 0 ? { parts: fullParts } : {}),
								...(backupError ? { backupError } : {}),
							});
						} catch (error) {
							const message = redactSecrets(
								error instanceof Error ? error.message : "Agent stream failed.",
								secretValues,
							);
							enqueue("error", { message });
							enqueue("done", {
								ok: false,
								assistantMessageId,
								content: "",
								...(message ? { backupError: message } : {}),
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
