// How a provider's answer reads as a connection fault, shared by the Bot (a turn's call) and
// Credentials (its probes), so both judge an answer the same way.

import type { Fault } from "../credentials-rpc.ts";

/** When a limit lifts, as a 429's `retry-after-ms` or `retry-after` says, if it says. */
export function resetsAt(headers: Headers, now = Date.now()): string | undefined {
	const ms = Number(headers.get("retry-after-ms"));
	if (ms > 0) return new Date(now + ms).toISOString();
	const after = headers.get("retry-after");
	if (!after) return undefined;
	const seconds = Number(after);
	if (seconds > 0) return new Date(now + seconds * 1000).toISOString();
	const date = Date.parse(after);
	return Number.isNaN(date) ? undefined : new Date(date).toISOString();
}

/**
 * The fault in a provider's answer: its HTTP status and headers when it answered,
 * "unreachable" when the request never got an answer, and the error a stream ended with,
 * since a limit can also arrive after the reply began. Null when the answer says nothing
 * about the connection, or no request was made.
 */
export function faultOf(
	answer: { status: number; headers: Headers } | "unreachable" | null,
	error = "",
): Fault | null {
	if (answer === "unreachable") return { state: "Unavailable" };
	if (answer?.status === 429) {
		const resets = resetsAt(answer.headers);
		return resets ? { state: "Throttled", resetsAt: resets } : { state: "Throttled" };
	}
	if (/rate_limit_exceeded|usage_limit_reached/i.test(error)) return { state: "Throttled" };
	// The provider no longer accepts the credential: only the owner can fix that.
	if (answer?.status === 401 || answer?.status === 403) return { state: "ReconnectNeeded" };
	if (answer && answer.status >= 500) return { state: "Unavailable" };
	return null;
}
