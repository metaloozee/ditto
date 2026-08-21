import { TRPCError } from "@trpc/server";
import { SessionGitPushUnavailableError } from "#/lib/git-push-contract";
import { SessionWorkspaceBusyError } from "#/lib/session-workspace-lock-error";

export function rethrowOrMapSessionGitMutationError(
	error: unknown,
	options: { fallbackMessage: string; forbiddenWhenMessage: string },
): never {
	if (error instanceof TRPCError) {
		throw error;
	}
	if (error instanceof SessionGitPushUnavailableError) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: error.message,
		});
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
