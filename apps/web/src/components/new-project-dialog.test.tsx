/** @vitest-environment jsdom */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal(
	"ResizeObserver",
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
);
HTMLElement.prototype.scrollIntoView = vi.fn();
HTMLElement.prototype.getAnimations = vi.fn(() => []);

const mutateAsyncMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
		"@tanstack/react-query",
	);
	return {
		...actual,
		useMutation: () => ({
			mutateAsync: mutateAsyncMock,
			isPending: false,
			error: null,
			reset: vi.fn(),
		}),
		useQuery: () => ({
			isLoading: false,
			isFetching: false,
			error: null,
			data: {
				installUrl: "https://github.com/apps/ditto/installations/new",
				installations: [{ id: 7 }],
				repositories: [
					{
						id: 42,
						name: "acme/storefront",
						owner: "acme",
						repoName: "storefront",
						language: "TypeScript",
						isPrivate: true,
						stars: 3,
						installationId: 7,
					},
				],
			},
			refetch: vi.fn(),
		}),
		useQueryClient: () => ({
			invalidateQueries: invalidateQueriesMock,
		}),
	};
});

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
}));

vi.mock("#/integrations/trpc/react", () => ({
	useTRPC: () => ({
		github: { importState: { queryOptions: () => ({}) } },
		projects: {
			create: { mutationOptions: () => ({}) },
			list: { queryFilter: () => ({ queryKey: ["projects", "list"] }) },
		},
	}),
}));

const { NewProjectDialog } = await import("./new-project-dialog");

describe("NewProjectDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mutateAsyncMock.mockResolvedValue({ id: "project-1" });
		invalidateQueriesMock.mockResolvedValue(undefined);
		navigateMock.mockResolvedValue(undefined);
	});

	afterEach(cleanup);

	it("creates a project from the selected repository", async () => {
		const onOpenChange = vi.fn();
		render(<NewProjectDialog open onOpenChange={onOpenChange} />);

		expect(screen.queryByText(/start from scratch/i)).toBeNull();
		fireEvent.click(screen.getByText("acme/storefront"));
		fireEvent.click(screen.getByRole("button", { name: "Create project" }));

		await waitFor(() => {
			expect(mutateAsyncMock).toHaveBeenCalledWith({
				name: "storefront",
				githubRepo: "acme/storefront",
				githubInstallationId: 7,
				envVars: [],
			});
		});
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(navigateMock).toHaveBeenCalledWith({
			to: "/project/$projectId",
			params: { projectId: "project-1" },
		});
	});
});
