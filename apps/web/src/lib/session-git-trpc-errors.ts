import { TRPCError } from "@trpc/server";
import { SessionWorkspaceBusyError } from "#/lib/session-workspace-lock-error";

export function rethrowOrMapSessionGitMutationError(
	error: unknown,
	options: { fallbackMessage: string; forbiddenWhenMessage: string },
): never {
	if (error instanceof TRPCError) {
		throw error;
	}
	if (error instanceof SessionWorkspaceBusyError) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: error.message,
		});
	}
	const message =
		error instanceof Error ? error.message : options.fallbackMessage;
	throw new TRPCError({
		code:
			message === options.forbiddenWhenMessage ? "FORBIDDEN" : "BAD_GATEWAY",
		message,
	});
}
