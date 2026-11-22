// Workflow grades from ADR-0004.
export type Grade = "pass" | "works with take-over" | "unsupported";

export type Run = {
	/** The owner took over to complete a login or challenge. */
	tookOver: boolean;
	/** The owner had to operate the site beyond the login or challenge. */
	steppedThrough: boolean;
	/** The bot finished the representative task (after hand-back, if there was a take-over). */
	botFinished: boolean;
};

export function grade({ tookOver, steppedThrough, botFinished }: Run): Grade {
	if (steppedThrough || !botFinished) return "unsupported";
	return tookOver ? "works with take-over" : "pass";
}
