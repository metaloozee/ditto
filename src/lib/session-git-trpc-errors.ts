import { TRPCError } from "@trpc/server";

export function rethrowOrMapSessionGitMutationError(
	error: unknown,
	options: { fallbackMessage: string; forbiddenWhenMessage: string },
): never {
	if (error instanceof TRPCError) {
		throw error;
	}
	const message =
		error instanceof Error ? error.message : options.fallbackMessage;
	throw new TRPCError({
		code:
			message === options.forbiddenWhenMessage ? "FORBIDDEN" : "BAD_GATEWAY",
		message,
	});
}
