/** @vitest-environment jsdom */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mutateAsyncMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const clearSessionMessagesMock = vi.hoisted(() => vi.fn());
const queryFilterMock = vi.hoisted(() => ({ queryKey: ["projects", "list"] }));

vi.mock("@tanstack/react-query", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
		"@tanstack/react-query",
	);
	return {
		...actual,
		useMutation: () => ({
			mutateAsync: mutateAsyncMock,
			isPending: false,
		}),
		useQueryClient: () => ({
			invalidateQueries: invalidateQueriesMock,
		}),
	};
});

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		...props
	}: React.PropsWithChildren<Record<string, unknown>>) => (
		<a href="/session" {...props}>
			{children}
		</a>
	),
	useNavigate: () => navigateMock,
	useParams: () => ({}),
	ClientOnly: ({ children }: React.PropsWithChildren) => children,
}));

vi.mock("#/integrations/trpc/react", () => ({
	useTRPC: () => ({
		workspace: {
			deleteSession: {
				mutationOptions: () => ({}),
			},
		},
		projects: {
			list: {
				queryFilter: () => queryFilterMock,
			},
		},
	}),
}));

vi.mock("#/lib/chat-session-cache", () => ({
	clearSessionMessages: clearSessionMessagesMock,
}));

vi.mock("#/lib/auth.client", () => ({
	authClient: {
		useSession: () => ({ data: null }),
	},
}));

const { SessionSidebarItem } = await import("./app-sidebar");

const session = {
	id: "sess-1",
	projectId: "proj-1",
	title: "My chat",
	status: "active" as const,
};

const project = {
	id: "proj-1",
	name: "Demo",
	status: "ready" as const,
	sessions: [session],
};

describe("SessionSidebarItem archive UX", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mutateAsyncMock.mockResolvedValue({ id: "sess-1" });
		invalidateQueriesMock.mockResolvedValue(undefined);
		navigateMock.mockResolvedValue(undefined);
	});

	afterEach(() => {
		cleanup();
	});

	it("shows Archive copy, archives once, clears cache, and invalidates list", async () => {
		render(
			<ul>
				<SessionSidebarItem
					session={session}
					project={project}
					isActive={false}
				/>
			</ul>,
		);

		// Open actions menu then archive confirm.
		fireEvent.click(
			screen.getByRole("button", { name: /actions for my chat/i }),
		);
		expect(screen.getByText("Archive Session")).toBeTruthy();
		fireEvent.click(screen.getByText("Archive Session"));

		expect(screen.getByText("Archive session?")).toBeTruthy();
		expect(
			screen.getByText(
				/disappear from the active list and cannot receive new messages/i,
			),
		).toBeTruthy();
		expect(screen.queryByText(/permanently lost/i)).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Archive" }));

		await waitFor(() => {
			expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
		});
		expect(mutateAsyncMock).toHaveBeenCalledWith({
			projectId: "proj-1",
			sessionId: "sess-1",
		});
		expect(clearSessionMessagesMock).toHaveBeenCalledWith("sess-1");
		expect(invalidateQueriesMock).toHaveBeenCalledWith(queryFilterMock);
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("navigates away when archiving the active session", async () => {
		render(
			<ul>
				<SessionSidebarItem
					session={session}
					project={project}
					isActive={true}
				/>
			</ul>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: /actions for my chat/i }),
		);
		fireEvent.click(screen.getByText("Archive Session"));
		fireEvent.click(screen.getByRole("button", { name: "Archive" }));

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/project/$projectId",
				params: { projectId: "proj-1" },
			});
		});
	});
});
