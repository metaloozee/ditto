import type { FlueContext, WorkflowRouteHandler } from "@flue/runtime";
import projectCoderAgent from "../agents/project-coder";
import {
	createMutatingProjectTools,
	type MutatingProjectToolContext,
} from "../lib/project-mutating-tools";

type DittoProjectRunEnv = Parameters<typeof createMutatingProjectTools>[0];

type DittoProjectRunPayload = MutatingProjectToolContext & {
	userId: string;
	message: string;
	modelSpecifier: string;
};

export const route: WorkflowRouteHandler = async (_c, next) => next();

function requireString(input: Record<string, unknown>, key: string): string {
	const value = input[key];
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Missing ${key}.`);
	}
	return value;
}

function parsePayload(value: unknown): DittoProjectRunPayload {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Invalid Ditto project run payload.");
	}

	const input = value as Record<string, unknown>;
	const fencingToken = input.fencingToken;
	if (typeof fencingToken !== "number") {
		throw new Error("Missing fencing token.");
	}

	return {
		projectId: requireString(input, "projectId"),
		sessionId: requireString(input, "sessionId"),
		runId: requireString(input, "runId"),
		userId: requireString(input, "userId"),
		sandboxId: requireString(input, "sandboxId"),
		message: requireString(input, "message"),
		modelSpecifier: requireString(input, "modelSpecifier"),
		fencingToken,
	};
}

export async function run(ctx: FlueContext<unknown, DittoProjectRunEnv>) {
	const payload = parsePayload(ctx.payload);
	const harness = await ctx.init(projectCoderAgent, {
		name: "mutating",
	});
	const session = await harness.session(payload.runId);
	const result = await session.prompt(payload.message, {
		model: payload.modelSpecifier,
		tools: createMutatingProjectTools(ctx.env, payload),
	});

	ctx.log.info("Ditto mutating project run completed.", {
		projectId: payload.projectId,
		sessionId: payload.sessionId,
		runId: payload.runId,
	});

	return result;
}
