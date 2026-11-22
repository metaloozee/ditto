// Workflow grades from ADR-0004.
export type Grade = "pass" | "works with take-over" | "unsupported";

export type Run = {
	/** The owner took over to complete a login or challenge. */
	tookOver: boolean;
	/** The owner had to operate the site beyond the login or challenge. */
	steppedThrough: boolean;
	/** The bot reached the representative signed-in page on its own (after hand-back, if any). */
	botSignedIn: boolean;
};

export function grade({ tookOver, steppedThrough, botSignedIn }: Run): Grade {
	if (steppedThrough || !botSignedIn) return "unsupported";
	return tookOver ? "works with take-over" : "pass";
}
