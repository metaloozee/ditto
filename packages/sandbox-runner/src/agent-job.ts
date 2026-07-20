/** Trust-boundary job shape + validator for the sandbox agent CLI. */

const THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export type Job = {
	runId: string;
	conversationId: string;
	model: string;
	prompt: string;
	cwd?: string;
	thinkingLevel?: ThinkingLevel;
};

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return (
		typeof value === "string" &&
		(THINKING_LEVELS as readonly string[]).includes(value)
	);
}

export function parseJob(raw: string): { job?: Job; error?: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { error: "Job file must contain valid JSON" };
	}

	if (!parsed || typeof parsed !== "object") {
		return { error: "Job must be a JSON object" };
	}

	const job = parsed as Partial<Job>;
	if (!isNonEmptyString(job.runId)) {
		return { error: "runId is required" };
	}
	if (!isNonEmptyString(job.conversationId)) {
		return { error: "conversationId is required" };
	}
	if (!isNonEmptyString(job.model)) {
		return { error: "model is required" };
	}
	if (!isNonEmptyString(job.prompt)) {
		return { error: "prompt is required" };
	}
	if (job.cwd !== undefined && !isNonEmptyString(job.cwd)) {
		return { error: "cwd must be a non-empty string when provided" };
	}
	if (job.thinkingLevel !== undefined && !isThinkingLevel(job.thinkingLevel)) {
		return { error: "thinkingLevel must be a canonical Pi level" };
	}

	return {
		job: {
			runId: job.runId,
			conversationId: job.conversationId,
			model: job.model,
			prompt: job.prompt,
			cwd: job.cwd,
			thinkingLevel: job.thinkingLevel,
		},
	};
}
