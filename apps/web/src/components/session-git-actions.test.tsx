/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const statusQueryMock = vi.hoisted(() => vi.fn());
const mutateMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
		"@tanstack/react-query",
	);
	return {
		...actual,
		useMutation: () => ({ isPending: false, mutate: mutateMock }),
		useQuery: () => statusQueryMock(),
		useQueryClient: () => ({
			invalidateQueries: vi.fn(),
			setQueryData: vi.fn(),
		}),
	};
});

vi.mock("#/integrations/trpc/react", () => ({
	useTRPC: () => ({
		sessionGit: {
			gitStatus: {
				queryOptions: () => ({ queryKey: ["session-git-status"] }),
				queryFilter: () => ({ queryKey: ["session-git-status"] }),
			},
			commit: { mutationOptions: () => ({}) },
			sync: { mutationOptions: () => ({}) },
			push: { mutationOptions: () => ({}) },
			openPullRequest: { mutationOptions: () => ({}) },
		},
	}),
}));

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() },
}));

const { SessionGitActions } = await import("./session-git-actions");

function setStatus(workflow: Record<string, unknown>) {
	statusQueryMock.mockReturnValue({
		data: {
			branch: "ditto/session-sess-1",
			dirty: workflow.kind === "commit",
			ahead: workflow.kind === "push" ? 1 : 0,
			hasBranchChanges: workflow.kind !== "idle",
			remoteBranchExists: workflow.kind !== "push",
			changedFiles: [],
			summary: "Clean working tree on ditto/session-sess-1",
			pullRequest: "pullRequest" in workflow ? workflow.pullRequest : null,
			workflow,
		},
		isError: false,
		isLoading: false,
	});
}

describe("SessionGitActions workflow", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it("disables Open PR for an untouched session", () => {
		setStatus({ kind: "idle", reason: "no-changes" });

		render(<SessionGitActions projectId="proj-1" sessionId="sess-1" />);

		expect(screen.getByRole("button", { name: "Open PR" })).toHaveProperty(
			"disabled",
			true,
		);
	});

	it("makes Push the next step when the remote branch is missing", () => {
		setStatus({ kind: "push", reason: "remote-branch-missing" });

		render(<SessionGitActions projectId="proj-1" sessionId="sess-1" />);

		expect(
			screen.getByRole("button", { name: "Push" }).getAttribute("aria-current"),
		).toBe("step");
		expect(screen.getByRole("button", { name: "Open PR" })).toHaveProperty(
			"disabled",
			false,
		);
	});

	it("makes Sync main the next step when the base branch advances", () => {
		setStatus({ kind: "sync", baseBranch: "main" });

		render(<SessionGitActions projectId="proj-1" sessionId="sess-1" />);

		expect(
			screen.getByRole("button", { name: "Sync" }).getAttribute("aria-current"),
		).toBe("step");
		expect(screen.getByRole("button", { name: "Sync" })).toHaveProperty(
			"disabled",
			false,
		);
	});

	it.each([
		["merged-pr", "merged", "Merged #12"],
		["closed-pr", "closed", "Closed #12"],
	] as const)("renders %s as a view-only PR state", (kind, state, label) => {
		setStatus({
			kind,
			pullRequest: {
				url: "https://github.com/acme/repo/pull/12",
				number: 12,
				state,
			},
		});

		render(<SessionGitActions projectId="proj-1" sessionId="sess-1" />);

		expect(screen.getByRole("button", { name: label })).toHaveProperty(
			"disabled",
			false,
		);
		expect(screen.queryByRole("button", { name: "Open PR" })).toBeNull();
	});

	it("disables Open PR when GitHub state is unavailable", () => {
		setStatus({ kind: "unavailable", reason: "github" });

		render(<SessionGitActions projectId="proj-1" sessionId="sess-1" />);

		expect(screen.getByRole("button", { name: "Open PR" })).toHaveProperty(
			"disabled",
			true,
		);
	});
});
