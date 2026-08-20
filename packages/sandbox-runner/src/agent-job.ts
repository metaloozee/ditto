/** Trust-boundary job shape + validator for the sandbox agent CLI. */

const RUNNER_MODEL_SPECIFIER = "opencode/deepseek-v4-flash-free" as const;

const THINKING_LEVELS = ["off", "high", "max"] as const;

type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export type Job = {
	runId: string;
	conversationId: string;
	model: typeof RUNNER_MODEL_SPECIFIER;
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
	if (job.model !== RUNNER_MODEL_SPECIFIER) {
		return { error: `Unknown model: ${job.model}` };
	}
	if (!isNonEmptyString(job.prompt)) {
		return { error: "prompt is required" };
	}
	if (job.cwd !== undefined && !isNonEmptyString(job.cwd)) {
		return { error: "cwd must be a non-empty string when provided" };
	}
	if (job.thinkingLevel !== undefined && !isThinkingLevel(job.thinkingLevel)) {
		return { error: "thinkingLevel must be off, high, or max" };
	}

	return {
		job: {
			runId: job.runId,
			conversationId: job.conversationId,
			model: RUNNER_MODEL_SPECIFIER,
			prompt: job.prompt,
			cwd: job.cwd,
			thinkingLevel: job.thinkingLevel,
		},
	};
}
