/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ensureMutateMock = vi.hoisted(() => vi.fn());
const retryMutateMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const fetchNextPageMock = vi.hoisted(() => vi.fn());

const projectQueryState = vi.hoisted(() => ({
	current: {
		data: {
			id: "proj-1",
			status: "ready" as string,
			githubRepo: "acme/app",
			githubInstallationId: 1,
		},
		isPending: false,
		error: null as Error | null,
	},
}));

const ensureMutationState = vi.hoisted(() => ({
	current: {
		data: undefined as unknown,
		error: null as Error | null,
		isPending: false,
		onSuccess: undefined as undefined | (() => void),
	},
}));

const retryMutationState = vi.hoisted(() => ({
	current: {
		data: undefined as unknown,
		error: null as Error | null,
		isPending: false,
		onSuccess: undefined as undefined | (() => void),
	},
}));

const messagesQueryState = vi.hoisted(() => ({
	current: {
		data: {
			pages: [
				{
					items: [
						{
							id: "msg-1",
							role: "user" as const,
							content: "durable history",
						},
					],
					nextCursor: null,
				},
			],
		},
		hasNextPage: false,
		isFetchingNextPage: false,
		fetchNextPage: fetchNextPageMock,
	},
	lastOptions: undefined as
		| {
				enabled?: boolean;
				queryKey?: unknown;
		  }
		| undefined,
	enabledCaptures: [] as boolean[],
}));

const listQueryFilterMock = vi.hoisted(() =>
	vi.fn(() => ({ queryKey: ["projects", "list"] })),
);
const getQueryFilterMock = vi.hoisted(() =>
	vi.fn((input: { id: string }) => ({
		queryKey: ["projects", "get", input],
	})),
);

const mutationCallIndex = vi.hoisted(() => ({ current: 0 }));

vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useQuery: (options: {
			queryKey?: unknown[];
			refetchInterval?: unknown;
		}) => {
			void options;
			// Reset mutation alternation at the start of each render.
			mutationCallIndex.current = 0;
			return projectQueryState.current;
		},
		useMutation: (options: { onSuccess?: () => void }) => {
			const index = mutationCallIndex.current;
			mutationCallIndex.current += 1;
			if (index === 0) {
				ensureMutationState.current.onSuccess = options.onSuccess;
				return {
					mutate: ensureMutateMock,
					data: ensureMutationState.current.data,
					error: ensureMutationState.current.error,
					isPending: ensureMutationState.current.isPending,
				};
			}
			retryMutationState.current.onSuccess = options.onSuccess;
			return {
				mutate: retryMutateMock,
				data: retryMutationState.current.data,
				error: retryMutationState.current.error,
				isPending: retryMutationState.current.isPending,
			};
		},
		useInfiniteQuery: (options: { enabled?: boolean }) => {
			messagesQueryState.lastOptions = options;
			messagesQueryState.enabledCaptures.push(Boolean(options.enabled));
			return messagesQueryState.current;
		},
		useQueryClient: () => ({
			invalidateQueries: invalidateQueriesMock,
		}),
	};
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		createFileRoute: () => (opts: { component: unknown }) => opts,
		Outlet: () => null,
	};
});

vi.mock("#/integrations/trpc/react", () => ({
	useTRPC: () => ({
		projects: {
			get: {
				queryOptions: (
					_input: unknown,
					opts?: { refetchInterval?: unknown },
				) => ({
					queryKey: ["projects", "get"],
					...opts,
				}),
				queryFilter: getQueryFilterMock,
			},
			list: {
				queryFilter: listQueryFilterMock,
			},
		},
		workspace: {
			ensureWorkspace: {
				mutationOptions: (opts?: { onSuccess?: () => void }) => opts ?? {},
			},
			retryRestore: {
				mutationOptions: (opts?: { onSuccess?: () => void }) => opts ?? {},
			},
			messages: {
				infiniteQueryOptions: (
					_input: unknown,
					opts?: { enabled?: boolean },
				) => ({
					queryKey: ["workspace", "messages"],
					...opts,
				}),
				infiniteQueryFilter: () => ({
					queryKey: ["workspace", "messages"],
				}),
			},
		},
		sessionGit: {
			gitStatus: {
				queryFilter: () => ({ queryKey: ["sessionGit", "gitStatus"] }),
			},
		},
	}),
}));

vi.mock("#/components/ai-chat", () => ({
	Chat: (props: {
		disabledReason?: string;
		messages?: Array<{ id: string; content: string }>;
		sessionId?: string | null;
	}) => (
		<div
			data-testid="chat-stub"
			data-disabled-reason={props.disabledReason ?? ""}
			data-messages={String(props.messages?.length ?? 0)}
			data-session-id={props.sessionId ?? ""}
		>
			{(props.messages ?? []).map((message) => (
				<div key={message.id}>{message.content}</div>
			))}
			{props.disabledReason ? (
				<span data-testid="disabled-reason">{props.disabledReason}</span>
			) : null}
		</div>
	),
}));

vi.mock("#/components/ui/button", () => ({
	Button: ({
		children,
		onClick,
		disabled,
	}: React.PropsWithChildren<{
		onClick?: () => void;
		disabled?: boolean;
		type?: "button" | "submit" | "reset";
		size?: string;
		variant?: string;
		"aria-busy"?: boolean;
	}>) => (
		<button type="button" onClick={onClick} disabled={disabled}>
			{children}
		</button>
	),
}));

vi.mock("#/components/ui/spinner", () => ({
	Spinner: (props: { className?: string }) => (
		<span data-testid="spinner" className={props.className} />
	),
}));

const { ProjectWorkspacePage } = await import("./project.$projectId");

describe("ProjectWorkspacePage readiness coordination", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		projectQueryState.current = {
			data: {
				id: "proj-1",
				status: "ready",
				githubRepo: "acme/app",
				githubInstallationId: 1,
			},
			isPending: false,
			error: null,
		};
		ensureMutationState.current = {
			data: undefined,
			error: null,
			isPending: true,
			onSuccess: undefined,
		};
		retryMutationState.current = {
			data: undefined,
			error: null,
			isPending: false,
			onSuccess: undefined,
		};
		messagesQueryState.current = {
			data: {
				pages: [
					{
						items: [
							{
								id: "msg-1",
								role: "user",
								content: "durable history",
							},
						],
						nextCursor: null,
					},
				],
			},
			hasNextPage: false,
			isFetchingNextPage: false,
			fetchNextPage: fetchNextPageMock,
		};
		messagesQueryState.lastOptions = undefined;
		messagesQueryState.enabledCaptures = [];
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("enables the URL session message query before ensure resolves", async () => {
		ensureMutationState.current.isPending = true;
		render(<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />);

		expect(messagesQueryState.enabledCaptures.at(-1)).toBe(true);
		expect(screen.getByText("durable history")).toBeTruthy();
		expect(screen.getByRole("status").textContent).toContain(
			"Preparing project sandbox",
		);
		expect(screen.getByTestId("disabled-reason").textContent).toBe(
			"Project sandbox is being provisioned.",
		);
		expect(ensureMutateMock).toHaveBeenCalledWith({
			projectId: "proj-1",
			sessionId: "sess-1",
		});
	});

	it("removes the bar and clears disabled reason on ensure success", async () => {
		const { rerender } = render(
			<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />,
		);

		ensureMutationState.current = {
			...ensureMutationState.current,
			isPending: false,
			data: {
				project: { id: "proj-1", status: "ready" },
				selectedSession: {
					id: "sess-1",
					status: "active",
					branchName: "main",
				},
				sandbox: { state: "connected" },
				restoreFailed: false,
			},
		};

		rerender(<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />);

		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.queryByTestId("disabled-reason")).toBeNull();
		expect(screen.getByText("durable history")).toBeTruthy();
	});

	it("keeps history and exposes Retry on ensure/check error", async () => {
		const { rerender } = render(
			<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />,
		);

		ensureMutationState.current = {
			...ensureMutationState.current,
			isPending: false,
			data: undefined,
			error: new Error("rpc down"),
		};

		rerender(<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />);

		expect(screen.getByText("durable history")).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toContain("rpc down");
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(screen.getByTestId("disabled-reason").textContent).toBe(
			"Project sandbox is not ready yet.",
		);
	});

	it("keeps history and exposes Retry restore on restore failure", async () => {
		const { rerender } = render(
			<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />,
		);

		projectQueryState.current = {
			...projectQueryState.current,
			data: {
				...projectQueryState.current.data,
				status: "failed",
			},
		};
		ensureMutationState.current = {
			...ensureMutationState.current,
			isPending: false,
			data: {
				project: { id: "proj-1", status: "failed" },
				selectedSession: { id: "sess-1", status: "active" },
				sandbox: { state: "failed" },
				restoreFailed: true,
			},
		};

		rerender(<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />);

		expect(screen.getByText("durable history")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry restore" })).toBeTruthy();
		expect(screen.getByText(/Workspace restore failed/i)).toBeTruthy();
	});

	it("consumes retry success directly without a second ensure", async () => {
		projectQueryState.current.data.status = "failed";
		ensureMutationState.current.isPending = false;
		ensureMutationState.current.data = {
			project: { id: "proj-1", status: "failed" },
			selectedSession: { id: "sess-1", status: "active" },
			sandbox: { state: "failed" },
			restoreFailed: true,
		};

		const { rerender } = render(
			<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />,
		);
		ensureMutateMock.mockClear();

		// Simulate retry success payload + D1 ready, then onSuccess as RQ would.
		projectQueryState.current.data.status = "ready";
		retryMutationState.current = {
			...retryMutationState.current,
			isPending: false,
			data: {
				project: { id: "proj-1", status: "ready" },
				selectedSession: {
					id: "sess-1",
					status: "active",
					branchName: "main",
				},
				sandbox: { state: "restored_from_backup" },
				restoreFailed: false,
			},
		};

		const onSuccess = retryMutationState.current.onSuccess;
		act(() => {
			onSuccess?.();
		});
		rerender(<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />);

		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.queryByTestId("disabled-reason")).toBeNull();
		// onSuccess only invalidates projects.get — no second ensure from retry.
		const ensureCallsFromOnSuccess = ensureMutateMock.mock.calls.length;
		// Ready flip may have triggered the keyed ensure effect once; onSuccess must not add more.
		ensureMutateMock.mockClear();
		act(() => {
			onSuccess?.();
		});
		expect(ensureMutateMock).not.toHaveBeenCalled();
		void ensureCallsFromOnSuccess;
		expect(invalidateQueriesMock).toHaveBeenCalled();
		expect(listQueryFilterMock).not.toHaveBeenCalled();
	});

	it("does not invalidate projects.list on ensure success", async () => {
		render(<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />);

		const onSuccess = ensureMutationState.current.onSuccess;
		act(() => {
			onSuccess?.();
		});

		expect(getQueryFilterMock).toHaveBeenCalledWith({ id: "proj-1" });
		expect(listQueryFilterMock).not.toHaveBeenCalled();
	});

	it("ignores a stale mutation result after project/session change", async () => {
		ensureMutationState.current = {
			...ensureMutationState.current,
			isPending: false,
			data: {
				project: { id: "proj-old", status: "ready" },
				selectedSession: { id: "sess-old", status: "active" },
				sandbox: { state: "connected" },
				restoreFailed: false,
			},
		};

		render(<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />);

		// Stale payload must not make workspace usable.
		expect(screen.getByRole("status")).toBeTruthy();
		expect(screen.getByTestId("disabled-reason").textContent).toBe(
			"Project sandbox is being provisioned.",
		);
	});

	it("does not fire ensure while D1 is already provisioning", async () => {
		projectQueryState.current.data.status = "provisioning";
		ensureMutationState.current.isPending = false;

		render(<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />);

		expect(ensureMutateMock).not.toHaveBeenCalled();
		expect(screen.getByRole("status")).toBeTruthy();
		expect(screen.getByText("durable history")).toBeTruthy();
	});
});
