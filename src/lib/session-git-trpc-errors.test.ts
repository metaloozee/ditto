import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { rethrowOrMapSessionGitMutationError } from "#/lib/session-git-trpc-errors";

const PUSH_FORBIDDEN_MESSAGE =
	"GitHub App cannot push to this repository. Update the app permissions.";

describe("rethrowOrMapSessionGitMutationError", () => {
	it("rethrows TRPCError unchanged", () => {
		const original = new TRPCError({
			code: "FORBIDDEN",
			message: PUSH_FORBIDDEN_MESSAGE,
		});

		try {
			rethrowOrMapSessionGitMutationError(original, {
				fallbackMessage: "Failed to open pull request.",
				forbiddenWhenMessage: "GitHub App cannot open pull requests.",
			});
			expect.fail("expected throw");
		} catch (error) {
			expect(error).toBe(original);
			expect((error as TRPCError).code).toBe("FORBIDDEN");
		}
	});

	it("maps forbidden message on plain Error", () => {
		try {
			rethrowOrMapSessionGitMutationError(new Error(PUSH_FORBIDDEN_MESSAGE), {
				fallbackMessage: "Failed to push branch.",
				forbiddenWhenMessage: PUSH_FORBIDDEN_MESSAGE,
			});
			expect.fail("expected throw");
		} catch (error) {
			expect(error).toBeInstanceOf(TRPCError);
			expect((error as TRPCError).code).toBe("FORBIDDEN");
			expect((error as TRPCError).message).toBe(PUSH_FORBIDDEN_MESSAGE);
		}
	});
});
