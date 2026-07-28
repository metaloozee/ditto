/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const provisionMutateMock = vi.hoisted(() => vi.fn());
const provisionMutateAsyncMock = vi.hoisted(() => vi.fn());
const retryMutateMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const fetchNextPageMock = vi.hoisted(() => vi.fn());
const checkRefetchMock = vi.hoisted(() => vi.fn());

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

const checkQueryState = vi.hoisted(() => ({
	current: {
		data: undefined as
			| undefined
			| {
					project: { id: string; status?: string };
					selectedSession?: {
						id: string;
						status?: string;
						branchName?: string | null;
					} | null;
					sandbox?: { state?: string };
					restoreFailed?: boolean;
			  },
		error: null as Error | null,
		isPending: false,
		isFetching: false,
		refetch: checkRefetchMock,
	},
}));

const provisionMutationState = vi.hoisted(() => ({
	current: {
		data: undefined as unknown,
		error: null as Error | null,
		isPending: false,
		onSuccess: undefined as undefined | (() => void | Promise<void>),
	},
}));

const retryMutationState = vi.hoisted(() => ({
	current: {
		data: undefined as unknown,
		error: null as Error | null,
		isPending: false,
		onSuccess: undefined as undefined | (() => void | Promise<void>),
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
const checkQueryFilterMock = vi.hoisted(() =>
	vi.fn((input: unknown) => ({
		queryKey: ["workspace", "checkSandbox", input],
	})),
);

const mutationCallIndex = vi.hoisted(() => ({ current: 0 }));

vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useQuery: (options: { queryKey?: unknown[] }) => {
			mutationCallIndex.current = 0;
			const key = JSON.stringify(options.queryKey ?? []);
			if (key.includes("checkSandbox")) return checkQueryState.current;
			return projectQueryState.current;
		},
		useMutation: (options: { onSuccess?: () => void | Promise<void> }) => {
			const index = mutationCallIndex.current;
			mutationCallIndex.current += 1;
			if (index === 0) {
				provisionMutationState.current.onSuccess = options.onSuccess;
				return {
					mutate: provisionMutateMock,
					mutateAsync: provisionMutateAsyncMock,
					data: provisionMutationState.current.data,
					error: provisionMutationState.current.error,
					isPending: provisionMutationState.current.isPending,
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
			checkSandbox: {
				queryOptions: (input: unknown, opts?: object) => ({
					queryKey: ["workspace", "checkSandbox", input],
					...opts,
				}),
				queryFilter: checkQueryFilterMock,
			},
			provisionSandbox: {
				mutationOptions: (opts?: object) => opts ?? {},
			},
			retryRestore: {
				mutationOptions: (opts?: object) => opts ?? {},
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

vi.mock("#/components/ui/sidebar", () => ({
	useSidebar: () => ({ state: "expanded", isMobile: false }),
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

const toastAddMock = vi.hoisted(() =>
	vi.fn((options: { id?: string }) => options.id ?? "toast-1"),
);
const toastUpdateMock = vi.hoisted(() => vi.fn());
const toastCloseMock = vi.hoisted(() => vi.fn());

vi.mock("#/components/ui/toast", () => ({
	toast: {
		add: toastAddMock,
		update: toastUpdateMock,
		close: toastCloseMock,
		promise: vi.fn(),
	},
}));

const { ProjectWorkspacePage } = await import("./project.$projectId");

function connectedCheck(overrides: Record<string, unknown> = {}) {
	return {
		data: {
			project: { id: "proj-1", status: "ready" },
			selectedSession: {
				id: "sess-1",
				status: "active",
				branchName: "main",
			},
			sandbox: { state: "connected" },
			restoreFailed: false,
			...overrides,
		},
		error: null,
		isPending: false,
		isFetching: false,
		refetch: checkRefetchMock,
	};
}

describe("ProjectWorkspacePage readiness coordination", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		toastAddMock.mockClear();
		toastUpdateMock.mockClear();
		toastCloseMock.mockClear();
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
		checkQueryState.current = {
			data: undefined,
			error: null,
			isPending: true,
			isFetching: true,
			refetch: checkRefetchMock,
		};
		provisionMutationState.current = {
			data: undefined,
			error: null,
			isPending: false,
			onSuccess: undefined,
		};
		retryMutationState.current = {
			data: undefined,
			error: null,
			isPending: false,
			onSuccess: undefined,
		};
		provisionMutateAsyncMock.mockReset();
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

	it("warm path: check connected → no toast, enabled, history visible", async () => {
		checkQueryState.current = connectedCheck();

		render(<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />);

		expect(toastAddMock).not.toHaveBeenCalled();
		expect(provisionMutateAsyncMock).not.toHaveBeenCalled();
		expect(screen.queryByTestId("disabled-reason")).toBeNull();
		expect(screen.getByText("durable history")).toBeTruthy();
		expect(messagesQueryState.enabledCaptures.at(-1)).toBe(true);
	});

	it("cold path: needs_restore → provisioning bar then success toast", async () => {
		checkQueryState.current = {
			data: {
				project: { id: "proj-1", status: "ready" },
				selectedSession: {
					id: "sess-1",
					status: "active",
					branchName: "main",
				},
				sandbox: { state: "needs_restore" },
				restoreFailed: false,
			},
			error: null,
			isPending: false,
			isFetching: false,
			refetch: checkRefetchMock,
		};

		provisionMutateAsyncMock.mockImplementation(async () => {
			const result = {
				project: { id: "proj-1", status: "ready" },
				selectedSession: {
					id: "sess-1",
					status: "active",
					branchName: "main",
				},
				sandbox: { state: "restored_from_backup" },
				restoreFailed: false,
			};
			provisionMutationState.current = {
				...provisionMutationState.current,
				isPending: false,
				data: result,
			};
			return result;
		});

		const { rerender } = render(
			<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />,
		);

		// Allow auto-provision effect to fire.
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(provisionMutateAsyncMock).toHaveBeenCalledTimes(1);
		expect(provisionMutateAsyncMock).toHaveBeenCalledWith({
			projectId: "proj-1",
			sessionId: "sess-1",
		});
		expect(toastAddMock).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "success",
				description: "Project sandbox ready",
			}),
		);
		expect(toastAddMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "loading" }),
		);

		// After success, check becomes connected (via invalidation in real app).
		checkQueryState.current = connectedCheck();
		rerender(<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />);
		expect(screen.queryByTestId("disabled-reason")).toBeNull();
		await waitFor(() => {
			expect(screen.queryByRole("status")).toBeNull();
		});
		expect(screen.getByText("durable history")).toBeTruthy();
	});

	it("D1 provisioning: no provision call, provisioning bar, disabled, history visible", async () => {
		projectQueryState.current.data.status = "provisioning";
		checkQueryState.current = {
			data: undefined,
			error: null,
			isPending: false,
			isFetching: false,
			refetch: checkRefetchMock,
		};

		render(<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />);

		expect(provisionMutateAsyncMock).not.toHaveBeenCalled();
		expect(toastAddMock).not.toHaveBeenCalled();
		expect(screen.getByRole("status").textContent).toMatch(
			/Preparing project sandbox/i,
		);
		expect(screen.getByTestId("disabled-reason").textContent).toBe(
			"Project sandbox is being provisioned.",
		);
		expect(screen.getByText("durable history")).toBeTruthy();
	});

	it("provision returns provisioning → bar until check connected, then success toast", async () => {
		checkQueryState.current = {
			data: {
				project: { id: "proj-1", status: "ready" },
				selectedSession: { id: "sess-1", status: "active" },
				sandbox: { state: "needs_restore" },
				restoreFailed: false,
			},
			error: null,
			isPending: false,
			isFetching: false,
			refetch: checkRefetchMock,
		};

		provisionMutateAsyncMock.mockResolvedValue({
			project: { id: "proj-1", status: "provisioning" },
			selectedSession: { id: "sess-1", status: "active" },
			sandbox: { state: "provisioning" },
			restoreFailed: false,
		});

		const { rerender } = render(
			<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />,
		);

		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		// No success toast yet; blue bar is up.
		expect(toastAddMock).not.toHaveBeenCalled();
		expect(screen.getByRole("status").textContent).toMatch(
			/Preparing project sandbox/i,
		);
		expect(screen.getByTestId("disabled-reason").textContent).toBe(
			"Project sandbox is being provisioned.",
		);

		// Check flips to connected → success toast.
		checkQueryState.current = connectedCheck();
		rerender(<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />);

		expect(toastAddMock).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "success",
				description: "Project sandbox ready",
			}),
		);
		await waitFor(() => {
			expect(screen.queryByRole("status")).toBeNull();
		});
		expect(screen.queryByTestId("disabled-reason")).toBeNull();
	});

	it("provision returns provisioning then check failed → failed bar, no error toast", async () => {
		checkQueryState.current = {
			data: {
				project: { id: "proj-1", status: "ready" },
				selectedSession: { id: "sess-1", status: "active" },
				sandbox: { state: "needs_restore" },
				restoreFailed: false,
			},
			error: null,
			isPending: false,
			isFetching: false,
			refetch: checkRefetchMock,
		};

		provisionMutateAsyncMock.mockResolvedValue({
			project: { id: "proj-1", status: "provisioning" },
			selectedSession: { id: "sess-1", status: "active" },
			sandbox: { state: "provisioning" },
			restoreFailed: false,
		});

		const { rerender } = render(
			<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />,
		);

		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		checkQueryState.current = {
			data: {
				project: { id: "proj-1", status: "failed" },
				selectedSession: { id: "sess-1", status: "active" },
				sandbox: { state: "failed" },
				restoreFailed: true,
			},
			error: null,
			isPending: false,
			isFetching: false,
			refetch: checkRefetchMock,
		};
		projectQueryState.current.data.status = "failed";
		rerender(<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />);

		expect(toastAddMock).not.toHaveBeenCalled();
		expect(screen.getByText(/Workspace restore failed/i)).toBeTruthy();
		expect(screen.queryByRole("status")).toBeNull();
	});

	it("check error: check-error bar + Retry; no provision toast; history visible", async () => {
		checkQueryState.current = {
			data: undefined,
			error: new Error("rpc down"),
			isPending: false,
			isFetching: false,
			refetch: checkRefetchMock,
		};

		render(<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />);

		expect(screen.getByText("durable history")).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toContain("rpc down");
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(toastAddMock).not.toHaveBeenCalled();
		expect(provisionMutateAsyncMock).not.toHaveBeenCalled();
		expect(screen.getByTestId("disabled-reason").textContent).toBe(
			"Project sandbox is not ready yet.",
		);
	});

	it("restore failed: restore-failed bar; history visible", async () => {
		projectQueryState.current.data.status = "failed";
		checkQueryState.current = {
			data: {
				project: { id: "proj-1", status: "failed" },
				selectedSession: { id: "sess-1", status: "active" },
				sandbox: { state: "failed" },
				restoreFailed: true,
			},
			error: null,
			isPending: false,
			isFetching: false,
			refetch: checkRefetchMock,
		};

		render(<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />);

		expect(screen.getByText("durable history")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry restore" })).toBeTruthy();
		expect(screen.getByText(/Workspace restore failed/i)).toBeTruthy();
	});

	it("restore failed + disabled check pending: Retry restore enabled, not Retrying", () => {
		// checkSandbox is disabled when d1Status === "failed"; RQ leaves isPending true.
		projectQueryState.current.data.status = "failed";
		checkQueryState.current = {
			data: undefined,
			error: null,
			isPending: true,
			isFetching: false,
			refetch: checkRefetchMock,
		};

		render(<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />);

		const btn = screen.getByRole("button", { name: "Retry restore" });
		expect(btn).toBeTruthy();
		expect((btn as HTMLButtonElement).disabled).toBe(false);
		expect(screen.queryByRole("button", { name: "Retrying\u2026" })).toBeNull();
	});

	it("retry restore success: onSuccess does not call provision", async () => {
		projectQueryState.current.data.status = "failed";
		checkQueryState.current = {
			data: {
				project: { id: "proj-1", status: "failed" },
				selectedSession: { id: "sess-1", status: "active" },
				sandbox: { state: "failed" },
				restoreFailed: true,
			},
			error: null,
			isPending: false,
			isFetching: false,
			refetch: checkRefetchMock,
		};

		render(<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />);
		provisionMutateAsyncMock.mockClear();

		const onSuccess = retryMutationState.current.onSuccess;
		await act(async () => {
			await onSuccess?.();
		});

		expect(provisionMutateAsyncMock).not.toHaveBeenCalled();
		expect(getQueryFilterMock).toHaveBeenCalledWith({ id: "proj-1" });
		expect(checkQueryFilterMock).toHaveBeenCalled();
		expect(listQueryFilterMock).not.toHaveBeenCalled();
	});

	it("does not invalidate projects.list on provision success", async () => {
		checkQueryState.current = {
			data: {
				project: { id: "proj-1", status: "ready" },
				selectedSession: { id: "sess-1", status: "active" },
				sandbox: { state: "needs_restore" },
				restoreFailed: false,
			},
			error: null,
			isPending: false,
			isFetching: false,
			refetch: checkRefetchMock,
		};
		provisionMutateAsyncMock.mockResolvedValue({
			project: { id: "proj-1", status: "ready" },
			selectedSession: { id: "sess-1", status: "active" },
			sandbox: { state: "connected" },
			restoreFailed: false,
		});

		render(<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />);

		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		const onSuccess = provisionMutationState.current.onSuccess;
		listQueryFilterMock.mockClear();
		await act(async () => {
			await onSuccess?.();
		});

		expect(getQueryFilterMock).toHaveBeenCalledWith({ id: "proj-1" });
		expect(listQueryFilterMock).not.toHaveBeenCalled();
	});

	it("ignores stale provision payload after projectId change", async () => {
		checkQueryState.current = {
			data: {
				project: { id: "proj-1", status: "ready" },
				selectedSession: { id: "sess-1", status: "active" },
				sandbox: { state: "needs_restore" },
				restoreFailed: false,
			},
			error: null,
			isPending: false,
			isFetching: false,
			refetch: checkRefetchMock,
		};

		// Hang provision so bar stays up.
		let resolveProvision!: (value: unknown) => void;
		provisionMutateAsyncMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveProvision = resolve;
				}),
		);

		const { rerender } = render(
			<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />,
		);

		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(screen.getByRole("status").textContent).toMatch(
			/Preparing project sandbox/i,
		);
		expect(toastAddMock).not.toHaveBeenCalled();

		// Switch project while provision is in flight.
		checkQueryState.current = {
			data: undefined,
			error: null,
			isPending: true,
			isFetching: true,
			refetch: checkRefetchMock,
		};
		rerender(<ProjectWorkspacePage projectId="proj-2" sessionId="sess-2" />);

		// Stale provision result for old project must not enable workspace.
		provisionMutationState.current = {
			...provisionMutationState.current,
			isPending: false,
			data: {
				project: { id: "proj-1", status: "ready" },
				selectedSession: { id: "sess-1", status: "active" },
				sandbox: { state: "connected" },
				restoreFailed: false,
			},
		};
		rerender(<ProjectWorkspacePage projectId="proj-2" sessionId="sess-2" />);

		expect(screen.getByTestId("disabled-reason")).toBeTruthy();

		// Clean up hanging promise.
		await act(async () => {
			resolveProvision({
				project: { id: "proj-1", status: "ready" },
				sandbox: { state: "connected" },
				restoreFailed: false,
			});
			await Promise.resolve();
		});
	});

	it("enables the URL session message query before check settles", async () => {
		checkQueryState.current = {
			data: undefined,
			error: null,
			isPending: true,
			isFetching: true,
			refetch: checkRefetchMock,
		};

		render(<ProjectWorkspacePage projectId="proj-1" sessionId="sess-1" />);

		expect(messagesQueryState.enabledCaptures.at(-1)).toBe(true);
		expect(screen.getByText("durable history")).toBeTruthy();
		// Warm check must not flash the provisioning bar.
		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.getByTestId("disabled-reason").textContent).toBe(
			"Project sandbox is not ready yet.",
		);
	});
});
