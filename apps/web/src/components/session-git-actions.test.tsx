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
});
