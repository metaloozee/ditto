import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { createDb } from "#/db";
import { projects } from "#/db/schema";
import { isProjectCoderModelSpecifier } from "#/lib/agent-models";
import { getProjectSandbox } from "#/lib/sandbox-bootstrap";
import { loadOwnedActiveSession } from "#/lib/workspace-session";

const CONTROL_DIRECTORY = "/tmp/ditto-agent-controls";
const CONTROL_CLI = "/opt/ditto-runner/dist/control-cli.js";
const CONTROL_TIMEOUT_MS = 5_000;
const MAX_CONTROL_OUTPUT = 64 * 1024;

const commonSchema = z.object({
	projectId: z.string().min(1),
	sessionId: z.string().min(1),
	runId: z.string().min(1).max(128),
});

export const agentControlBodySchema = z.discriminatedUnion("action", [
	commonSchema.extend({
		action: z.literal("follow_up"),
		model: z.string().min(1).refine(isProjectCoderModelSpecifier, {
			message: "Invalid model.",
		}),
		message: z.string().trim().min(1).max(32_000),
	}),
	commonSchema.extend({ action: z.literal("stop") }),
]);

export type AgentControlBody = z.infer<typeof agentControlBodySchema>;

export type AgentControlResult =
	| { kind: "accepted"; status: 200; body: Record<string, unknown> }
	| { kind: "error"; status: 404 | 409 | 500; body: { error: string } };

type ControlDeps = {
	createId?: () => string;
	loadProjectForUser?: (options: {
		db: ReturnType<typeof createDb>;
		projectId: string;
		userId: string;
	}) => Promise<typeof projects.$inferSelect | null>;
	loadOwnedActiveSession?: typeof loadOwnedActiveSession;
	getProjectSandbox?: typeof getProjectSandbox;
};

const defaultDeps: Required<ControlDeps> = {
	createId: () => nanoid(),
	loadProjectForUser: async ({ db, projectId, userId }) => {
		const [project] = await db
			.select()
			.from(projects)
			.where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
			.limit(1);
		return project ?? null;
	},
	loadOwnedActiveSession,
	getProjectSandbox,
};

function safeId(value: string): string {
	return value.replaceAll(/[^A-Za-z0-9_-]/g, "").slice(0, 128) || nanoid();
}

function quoteGeneratedPath(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function parseControlResponse(stdout: string): Record<string, unknown> {
	if (stdout.length > MAX_CONTROL_OUTPUT)
		throw new Error("Control response too large");
	const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
	if (lines.length !== 1) throw new Error("Invalid control response");
	let value: unknown;
	try {
		value = JSON.parse(lines[0]);
	} catch {
		throw new Error("Invalid control response");
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Invalid control response");
	}
	const response = value as Record<string, unknown>;
	if (typeof response.accepted !== "boolean") {
		throw new Error("Invalid control response");
	}
	return response;
}

export async function controlAgentRun(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	userId: string;
	input: AgentControlBody;
	deps?: ControlDeps;
}): Promise<AgentControlResult> {
	const deps = { ...defaultDeps, ...options.deps };
	const { db, env, userId, input } = options;
	const project = await deps.loadProjectForUser({
		db,
		projectId: input.projectId,
		userId,
	});
	if (!project) {
		return {
			kind: "error",
			status: 404,
			body: { error: "Project not found." },
		};
	}
	const session = await deps.loadOwnedActiveSession({
		db,
		projectId: input.projectId,
		sessionId: input.sessionId,
		userId,
	});
	if (!session) {
		return {
			kind: "error",
			status: 404,
			body: { error: "Session not found." },
		};
	}
	if (project.status !== "ready" || !project.sandboxId) {
		return {
			kind: "error",
			status: 409,
			body: { error: "Project sandbox is not ready." },
		};
	}

	const requestId = deps.createId();
	const correlation =
		input.action === "follow_up"
			? {
					userMessageId: deps.createId(),
					assistantMessageId: deps.createId(),
				}
			: undefined;
	const job =
		input.action === "follow_up"
			? {
					action: "follow_up" as const,
					requestId,
					runId: input.runId,
					sessionId: input.sessionId,
					model: input.model,
					text: input.message,
					...correlation,
				}
			: {
					action: "stop" as const,
					requestId,
					runId: input.runId,
					sessionId: input.sessionId,
				};
	const sandbox = deps.getProjectSandbox(env, project.sandboxId);
	const shell = await sandbox.createSession({
		id: `agent-control-${safeId(requestId)}`,
		commandTimeoutMs: CONTROL_TIMEOUT_MS,
	});
	const jobPath = `${CONTROL_DIRECTORY}/${safeId(requestId)}.json`;

	try {
		await shell.mkdir(CONTROL_DIRECTORY, { recursive: true });
		await shell.writeFile(jobPath, JSON.stringify(job));
		const result = await shell.exec(
			`node ${CONTROL_CLI} --job ${quoteGeneratedPath(jobPath)}`,
			{ timeout: CONTROL_TIMEOUT_MS },
		);
		if (!result.success && !result.stdout.trim()) {
			return {
				kind: "error",
				status: 409,
				body: { error: "The active agent run is no longer available." },
			};
		}
		let response: Record<string, unknown>;
		try {
			response = parseControlResponse(result.stdout);
		} catch {
			return {
				kind: "error",
				status: 409,
				body: { error: "The active agent run is no longer available." },
			};
		}
		if (!response.accepted) {
			return {
				kind: "error",
				status: 409,
				body: { error: "The active agent run could not accept that control." },
			};
		}
		return { kind: "accepted", status: 200, body: response };
	} catch {
		return {
			kind: "error",
			status: 409,
			body: { error: "The active agent run is no longer available." },
		};
	} finally {
		try {
			await shell.deleteFile(jobPath);
		} catch {
			// Best-effort cleanup after every outcome.
		}
		try {
			await sandbox.deleteSession(shell.id);
		} catch {
			// Best-effort cleanup after every outcome.
		}
	}
}
