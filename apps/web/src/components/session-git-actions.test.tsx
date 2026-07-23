/** @vitest-environment jsdom */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const statusQueryMock = vi.hoisted(() => vi.fn());
const mutateMock = vi.hoisted(() => vi.fn());
const mutationStateMock = vi.hoisted(() => ({
	commitPending: false,
	prPending: false,
	commitOptions: null as null | {
		onSuccess?: (result: unknown) => void;
		id?: string;
	},
	prOptions: null as null | {
		onSuccess?: (result: unknown) => void;
		id?: string;
	},
}));

vi.mock("@tanstack/react-query", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
		"@tanstack/react-query",
	);
	return {
		...actual,
		useMutation: (options: Record<string, unknown>) => {
			const isCommit = options === mutationStateMock.commitOptions;
			const isPr = options === mutationStateMock.prOptions;
			return {
				isPending: isCommit
					? mutationStateMock.commitPending
					: isPr
						? mutationStateMock.prPending
						: false,
				mutate: mutateMock,
			};
		},
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
			commit: {
				mutationOptions: (options: Record<string, unknown>) => {
					mutationStateMock.commitOptions = options as {
						onSuccess?: (result: unknown) => void;
					};
					return mutationStateMock.commitOptions;
				},
			},
			sync: {
				mutationOptions: () => ({ id: "sync" }),
			},
			push: {
				mutationOptions: () => ({ id: "push" }),
			},
			openPullRequest: {
				mutationOptions: (options: Record<string, unknown>) => {
					mutationStateMock.prOptions = options as {
						onSuccess?: (result: unknown) => void;
					};
					return mutationStateMock.prOptions;
				},
			},
		},
	}),
}));

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() },
}));

const { SessionGitActions } = await import("./session-git-actions");
const { toast } = await import("sonner");

function setStatus(
	workflow: Record<string, unknown>,
	extras: { pullRequest?: Record<string, unknown> | null } = {},
) {
	statusQueryMock.mockReturnValue({
		data: {
			branch: "ditto/session-sess-1",
			dirty: workflow.kind === "commit",
			ahead: workflow.kind === "push" ? 1 : 0,
			hasBranchChanges: workflow.kind !== "idle",
			remoteBranchExists: workflow.kind !== "push",
			changedFiles: [],
			summary: "Clean working tree on ditto/session-sess-1",
			pullRequest:
				extras.pullRequest !== undefined
					? extras.pullRequest
					: "pullRequest" in workflow
						? workflow.pullRequest
						: null,
			workflow,
		},
		isError: false,
		isLoading: false,
	});
}

function openGitMenu() {
	fireEvent.click(screen.getByRole("button", { name: "Choose git action" }));
	return screen.getByRole("menu");
}

function isMenuItemDisabled(item: HTMLElement): boolean {
	return (
		item.getAttribute("aria-disabled") === "true" ||
		item.hasAttribute("data-disabled") ||
		(item as HTMLButtonElement).disabled === true
	);
}

describe("SessionGitActions workflow", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mutationStateMock.commitPending = false;
		mutationStateMock.prPending = false;
		mutationStateMock.commitOptions = null;
		mutationStateMock.prOptions = null;
	});

	afterEach(() => {
		cleanup();
	});

	it("shows a spinner instead of stale git state while loading", () => {
		statusQueryMock.mockReturnValue({
			data: undefined,
			isError: false,
			isLoading: true,
		});

		render(<SessionGitActions projectId="proj-1" sessionId="sess-1" />);

		const loadingButton = screen.getByRole("button", {
			name: "Loading Git status",
		});
		expect(loadingButton).toHaveProperty("disabled", true);
		expect(loadingButton.querySelector(".animate-spin")).not.toBeNull();
	});

	it("disables Open PR for an untouched session", () => {
		setStatus({ kind: "idle", reason: "no-changes" });

		render(<SessionGitActions projectId="proj-1" sessionId="sess-1" />);

		expect(screen.getByRole("button", { name: "Up to date" })).toHaveProperty(
			"disabled",
			true,
		);

		const menu = openGitMenu();
		expect(
			isMenuItemDisabled(
				within(menu).getByRole("menuitem", { name: /Open PR/i }),
			),
		).toBe(true);
	});

	it("makes Push the next step when the remote branch is missing", () => {
		setStatus({ kind: "push", reason: "remote-branch-missing" });

		render(<SessionGitActions projectId="proj-1" sessionId="sess-1" />);

		expect(
			screen.getByRole("button", { name: "Push" }).getAttribute("aria-current"),
		).toBe("step");
		expect(screen.getByRole("button", { name: "Push" })).toHaveProperty(
			"disabled",
			false,
		);

		const menu = openGitMenu();
		expect(
			isMenuItemDisabled(
				within(menu).getByRole("menuitem", { name: /Open PR/i }),
			),
		).toBe(false);
	});

	it("makes Sync the next step when the base branch advances", () => {
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

		const menu = openGitMenu();
		expect(
			isMenuItemDisabled(
				within(menu).getByRole("menuitem", { name: /Open PR/i }),
			),
		).toBe(true);
	});

	it("disables Open PR when worktree is unavailable", () => {
		setStatus(
			{ kind: "unavailable", reason: "worktree" },
			// force PR as primary so tooltip is on the primary button
		);
		// When unavailable with no PR, primary is empty; open the menu and confirm disabled.
		render(<SessionGitActions projectId="proj-1" sessionId="sess-1" />);

		const menu = openGitMenu();
		expect(
			isMenuItemDisabled(
				within(menu).getByRole("menuitem", { name: /Open PR/i }),
			),
		).toBe(true);
	});

	it("labels an existing pull request clearly and includes its number in the tooltip", () => {
		setStatus({
			kind: "open-pr-existing",
			pullRequest: {
				url: "https://github.com/acme/repo/pull/7",
				number: 7,
				state: "open",
			},
		});

		render(<SessionGitActions projectId="proj-1" sessionId="sess-1" />);

		expect(
			screen.getByRole("button", { name: "View PR" }).getAttribute("title"),
		).toBe("View pull request #7 on GitHub");
	});

	it("keeps Push primary when ahead while View PR stays available", () => {
		setStatus(
			{ kind: "push", reason: "unpushed-commits" },
			{
				pullRequest: {
					url: "https://github.com/acme/repo/pull/9",
					number: 9,
					state: "open",
				},
			},
		);

		render(<SessionGitActions projectId="proj-1" sessionId="sess-1" />);

		expect(screen.getByRole("button", { name: "Push" })).toHaveProperty(
			"disabled",
			false,
		);

		const menu = openGitMenu();
		expect(
			isMenuItemDisabled(
				within(menu).getByRole("menuitem", { name: /View PR/i }),
			),
		).toBe(false);
	});

	it("uses drafting accessible labels while commit is pending and disables controls", () => {
		setStatus({ kind: "commit" });
		mutationStateMock.commitPending = true;

		render(<SessionGitActions projectId="proj-1" sessionId="sess-1" />);

		const primary = screen.getByRole("button", {
			name: "Drafting and committing…",
		});
		expect(primary).toHaveProperty("disabled", true);
		expect(primary.getAttribute("title")).toBe("Drafting and committing…");
		expect(
			screen.getByRole("button", { name: "Choose git action" }),
		).toHaveProperty("disabled", true);
	});

	it("uses drafting accessible labels while open PR is pending", () => {
		setStatus({ kind: "open-pr" });
		mutationStateMock.prPending = true;

		render(<SessionGitActions projectId="proj-1" sessionId="sess-1" />);

		const primary = screen.getByRole("button", {
			name: "Drafting and opening pull request…",
		});
		expect(primary).toHaveProperty("disabled", true);
		expect(primary.getAttribute("title")).toBe(
			"Drafting and opening pull request…",
		);
	});

	it("toasts the generated commit message text on success", () => {
		setStatus({ kind: "commit" });
		render(<SessionGitActions projectId="proj-1" sessionId="sess-1" />);

		mutationStateMock.commitOptions?.onSuccess?.({
			committed: true,
			commitSha: "abc",
			message: "feat: add billing",
		});

		expect(toast.success).toHaveBeenCalledWith(
			"Changes committed: feat: add billing",
		);
	});

	it("fires one-click commit mutate without a message editor", () => {
		setStatus({ kind: "commit" });
		render(<SessionGitActions projectId="proj-1" sessionId="sess-1" />);

		fireEvent.click(screen.getByRole("button", { name: "Commit" }));
		expect(mutateMock).toHaveBeenCalledWith({
			projectId: "proj-1",
			sessionId: "sess-1",
		});
	});
});
