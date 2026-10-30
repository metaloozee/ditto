/** @vitest-environment jsdom */
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startMutate = vi.hoisted(() => vi.fn());
const stopMutate = vi.hoisted(() => vi.fn());
const retryBackupMutate = vi.hoisted(() => vi.fn());
const runWorkspaceActionMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/candidate-session-client", async (importOriginal) => ({
	...(await importOriginal<typeof import("#/lib/candidate-session-client")>()),
	runWorkspaceAction: runWorkspaceActionMock,
}));

vi.mock("#/integrations/trpc/react", () => ({
	useTRPC: () => ({
		sessionPreview: {
			start: {
				mutationOptions: (opts: {
					onMutate?: () => void;
					onSuccess?: (r: unknown) => void;
					onError?: (e: Error) => void;
				}) => ({
					mutationFn: async (input: {
						projectId: string;
						sessionId: string;
					}) => {
						opts.onMutate?.();
						return startMutate(input, opts);
					},
				}),
			},
			stop: {
				mutationOptions: (opts: {
					onSuccess?: () => void;
					onError?: (e: Error) => void;
				}) => ({
					mutationFn: async (input: {
						projectId: string;
						sessionId: string;
					}) => {
						return stopMutate(input, opts);
					},
				}),
			},
		},
		workspace: {
			retryBackup: {
				mutationOptions: () => ({
					mutationFn: async (input: { projectId: string; sessionId: string }) =>
						retryBackupMutate(input),
				}),
			},
		},
	}),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useMutation: (options: {
			mutationFn: (input?: unknown) => Promise<unknown>;
		}) => ({
			mutate: (input?: unknown) => {
				void options.mutationFn(input);
			},
			isPending: false,
		}),
	};
});

const { SessionPreviewPane, SESSION_PREVIEW_PUBLIC_WARNING } = await import(
	"./session-preview-pane"
);

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

beforeEach(() => {
	startMutate.mockImplementation(
		async (
			_input: unknown,
			opts: {
				onSuccess?: (r: unknown) => void;
			},
		) => {
			const result = {
				status: "running",
				url: "https://10000-box-token.ayn.wtf",
				port: 10000,
				reused: false,
			};
			opts.onSuccess?.(result);
			return result;
		},
	);
	stopMutate.mockImplementation(
		async (
			_input: unknown,
			opts: {
				onSuccess?: () => void;
			},
		) => {
			opts.onSuccess?.();
			return { status: "stopped" };
		},
	);
});

describe("SessionPreviewPane", () => {
	it("shows public warning and starts with exact ids", async () => {
		render(<SessionPreviewPane projectId="proj-1" sessionId="sess-1" />);
		expect(screen.getByText(SESSION_PREVIEW_PUBLIC_WARNING)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Start preview now" }));
		await waitFor(() => {
			expect(startMutate).toHaveBeenCalledWith(
				{ projectId: "proj-1", sessionId: "sess-1" },
				expect.anything(),
			);
		});
	});

	it("renders iframe with restrictive attributes", async () => {
		render(<SessionPreviewPane projectId="proj-1" sessionId="sess-1" />);
		fireEvent.click(screen.getByRole("button", { name: "Start preview now" }));
		const iframe = await screen.findByTitle("Session website preview");
		expect(
			iframe.getAttribute("referrerpolicy") ||
				iframe.getAttribute("referrerPolicy"),
		).toMatch(/no-referrer/);
		expect(iframe.getAttribute("sandbox")).toBe(
			"allow-forms allow-same-origin allow-scripts",
		);
		expect(iframe.getAttribute("src")).toBe("https://10000-box-token.ayn.wtf");
		expect(screen.queryByText("https://10000-box-token.ayn.wtf")).toBeNull();
	});

	it("retries after failure", async () => {
		startMutate
			.mockImplementationOnce(
				async (_input: unknown, opts: { onError?: (e: Error) => void }) => {
					opts.onError?.(new Error("boom"));
				},
			)
			.mockImplementationOnce(
				async (_input: unknown, opts: { onSuccess?: (r: unknown) => void }) => {
					opts.onSuccess?.({
						status: "running",
						url: "https://10000-box-token.ayn.wtf",
						port: 10000,
						reused: false,
					});
				},
			);

		render(<SessionPreviewPane projectId="proj-1" sessionId="sess-1" />);
		fireEvent.click(screen.getByRole("button", { name: "Start preview now" }));
		expect(await screen.findByRole("alert")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await screen.findByTitle("Session website preview");
	});

	it("stops and discards url only after success", async () => {
		render(<SessionPreviewPane projectId="proj-1" sessionId="sess-1" />);
		fireEvent.click(screen.getByRole("button", { name: "Start preview now" }));
		await screen.findByTitle("Session website preview");
		fireEvent.click(screen.getByRole("button", { name: "Stop preview" }));
		await waitFor(() => {
			expect(stopMutate).toHaveBeenCalledWith(
				{ projectId: "proj-1", sessionId: "sess-1" },
				expect.anything(),
			);
		});
		await waitFor(() => {
			expect(screen.queryByTitle("Session website preview")).toBeNull();
		});
		expect(screen.getByText(SESSION_PREVIEW_PUBLIC_WARNING)).toBeTruthy();
	});

	it("suppresses stale session state without stopping", async () => {
		const { rerender } = render(
			<SessionPreviewPane projectId="proj-1" sessionId="sess-1" />,
		);
		fireEvent.click(screen.getByRole("button", { name: "Start preview now" }));
		await screen.findByTitle("Session website preview");
		rerender(<SessionPreviewPane projectId="proj-1" sessionId="sess-2" />);
		expect(screen.queryByTitle("Session website preview")).toBeNull();
		expect(screen.getByText(SESSION_PREVIEW_PUBLIC_WARNING)).toBeTruthy();
		expect(stopMutate).not.toHaveBeenCalled();
	});

	it("reloads while running by replacing url on success", async () => {
		startMutate
			.mockImplementationOnce(
				async (_input: unknown, opts: { onSuccess?: (r: unknown) => void }) => {
					opts.onSuccess?.({
						status: "running",
						url: "https://10000-box-token.ayn.wtf",
						port: 10000,
						reused: false,
					});
				},
			)
			.mockImplementationOnce(
				async (_input: unknown, opts: { onSuccess?: (r: unknown) => void }) => {
					opts.onSuccess?.({
						status: "running",
						url: "https://10001-box-token.ayn.wtf",
						port: 10001,
						reused: false,
					});
				},
			);

		render(<SessionPreviewPane projectId="proj-1" sessionId="sess-1" />);
		fireEvent.click(screen.getByRole("button", { name: "Start preview now" }));
		const first = await screen.findByTitle("Session website preview");
		expect(first.getAttribute("src")).toBe("https://10000-box-token.ayn.wtf");
		fireEvent.click(screen.getByRole("button", { name: "Reload preview" }));
		await waitFor(() => {
			expect(startMutate).toHaveBeenCalledTimes(2);
		});
		const second = await screen.findByTitle("Session website preview");
		expect(second.getAttribute("src")).toBe("https://10001-box-token.ayn.wtf");
	});

	it("stop then start replaces url with a fresh preview", async () => {
		startMutate
			.mockImplementationOnce(
				async (_input: unknown, opts: { onSuccess?: (r: unknown) => void }) => {
					opts.onSuccess?.({
						status: "running",
						url: "https://10000-box-token.ayn.wtf",
						port: 10000,
						reused: false,
					});
				},
			)
			.mockImplementationOnce(
				async (_input: unknown, opts: { onSuccess?: (r: unknown) => void }) => {
					opts.onSuccess?.({
						status: "running",
						url: "https://10001-box-token.ayn.wtf",
						port: 10001,
						reused: false,
					});
				},
			);

		render(<SessionPreviewPane projectId="proj-1" sessionId="sess-1" />);
		fireEvent.click(screen.getByRole("button", { name: "Start preview now" }));
		await screen.findByTitle("Session website preview");
		fireEvent.click(screen.getByRole("button", { name: "Stop preview" }));
		await waitFor(() => {
			expect(screen.queryByTitle("Session website preview")).toBeNull();
		});
		fireEvent.click(screen.getByRole("button", { name: "Start preview now" }));
		const iframe = await screen.findByTitle("Session website preview");
		expect(iframe.getAttribute("src")).toBe("https://10001-box-token.ayn.wtf");
	});

	it("keeps iframe url and shows alert when stop fails", async () => {
		stopMutate.mockImplementationOnce(
			async (_input: unknown, opts: { onError?: (e: Error) => void }) => {
				opts.onError?.(
					new Error("Failed to fully stop the preview. Try again."),
				);
			},
		);
		render(<SessionPreviewPane projectId="proj-1" sessionId="sess-1" />);
		fireEvent.click(screen.getByRole("button", { name: "Start preview now" }));
		await screen.findByTitle("Session website preview");
		fireEvent.click(screen.getByRole("button", { name: "Stop preview" }));
		await waitFor(() => {
			expect(stopMutate).toHaveBeenCalled();
		});
		const iframe = await screen.findByTitle("Session website preview");
		expect(iframe.getAttribute("src")).toBe("https://10000-box-token.ayn.wtf");
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toMatch(/Failed to fully stop the preview/);
	});

	it("clears stop error on successful stop", async () => {
		stopMutate
			.mockImplementationOnce(
				async (_input: unknown, opts: { onError?: (e: Error) => void }) => {
					opts.onError?.(
						new Error("Failed to fully stop the preview. Try again."),
					);
				},
			)
			.mockImplementationOnce(
				async (_input: unknown, opts: { onSuccess?: () => void }) => {
					opts.onSuccess?.();
					return { status: "stopped" };
				},
			);
		render(<SessionPreviewPane projectId="proj-1" sessionId="sess-1" />);
		fireEvent.click(screen.getByRole("button", { name: "Start preview now" }));
		await screen.findByTitle("Session website preview");
		fireEvent.click(screen.getByRole("button", { name: "Stop preview" }));
		await screen.findByRole("alert");
		fireEvent.click(screen.getByRole("button", { name: "Stop preview" }));
		await waitFor(() => {
			expect(screen.queryByRole("alert")).toBeNull();
		});
		expect(screen.queryByTitle("Session website preview")).toBeNull();
		expect(screen.getByText(SESSION_PREVIEW_PUBLIC_WARNING)).toBeTruthy();
	});

	it("clears stop error on reload", async () => {
		stopMutate.mockImplementationOnce(
			async (_input: unknown, opts: { onError?: (e: Error) => void }) => {
				opts.onError?.(
					new Error("Failed to fully stop the preview. Try again."),
				);
			},
		);
		render(<SessionPreviewPane projectId="proj-1" sessionId="sess-1" />);
		fireEvent.click(screen.getByRole("button", { name: "Start preview now" }));
		await screen.findByTitle("Session website preview");
		fireEvent.click(screen.getByRole("button", { name: "Stop preview" }));
		await screen.findByRole("alert");
		fireEvent.click(screen.getByRole("button", { name: "Reload preview" }));
		await waitFor(() => {
			expect(screen.queryByRole("alert")).toBeNull();
		});
		await screen.findByTitle("Session website preview");
	});

	it("shows Retry Backup and Restart Preview after a failed checkpoint", async () => {
		startMutate.mockImplementationOnce(
			async (_input: unknown, opts: { onError?: (e: Error) => void }) => {
				opts.onError?.(new Error("start failed"));
			},
		);
		render(
			<SessionPreviewPane
				projectId="proj-1"
				sessionId="sess-1"
				recovery={{
					state: "degraded",
					reasonCode: "checkpoint_failed",
					pending: true,
				}}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Start preview now" }));
		await screen.findByRole("alert");
		expect(screen.getByRole("button", { name: "Retry Backup" })).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Restart Preview" }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry Backup" }));
		await waitFor(() => {
			expect(retryBackupMutate).toHaveBeenCalledWith({
				projectId: "proj-1",
				sessionId: "sess-1",
			});
		});
	});

	describe("candidate mode", () => {
		const URL1 =
			"https://10000-c-0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d-tok.ayn.wtf/";
		const running = { status: "preview_running", generation: 1, url: URL1 };
		const renderCandidate = (extra = {}) =>
			render(
				<SessionPreviewPane
					projectId="proj-1"
					sessionId="sess-1"
					candidate
					{...extra}
				/>,
			);
		const clickStart = () =>
			fireEvent.click(
				screen.getByRole("button", { name: "Start preview now" }),
			);

		it("starts through workspace actions and renders the iframe", async () => {
			runWorkspaceActionMock.mockResolvedValueOnce(running);
			renderCandidate();
			clickStart();
			const iframe = await screen.findByTitle("Session website preview");
			expect(iframe.getAttribute("src")).toBe(URL1);
			expect(runWorkspaceActionMock).toHaveBeenCalledWith({
				kind: "preview_start",
				projectId: "proj-1",
				sessionId: "sess-1",
			});
			expect(startMutate).not.toHaveBeenCalled();
		});

		it("shows a generic message when start throws", async () => {
			runWorkspaceActionMock.mockRejectedValueOnce(new Error("x"));
			renderCandidate();
			clickStart();
			expect((await screen.findByRole("alert")).textContent).toMatch(
				/Failed to start preview\./,
			);
			expect(screen.queryByTitle("Session website preview")).toBeNull();
		});

		it("shows shared denial copy", async () => {
			runWorkspaceActionMock.mockResolvedValueOnce({
				status: "denied",
				reason: "capacity",
			});
			renderCandidate();
			clickStart();
			expect(
				await screen.findByText("No workspace slot is free right now."),
			).toBeTruthy();
		});

		it("self-heals once: start, stop, start", async () => {
			const expired = { status: "rejected", reason: "preview_url_unavailable" };
			runWorkspaceActionMock
				.mockResolvedValueOnce(expired)
				.mockResolvedValueOnce({ status: "preview_stopped", generation: 1 })
				.mockResolvedValueOnce(running);
			renderCandidate();
			clickStart();
			await screen.findByTitle("Session website preview");
			expect(
				runWorkspaceActionMock.mock.calls.map((call) => call[0].kind),
			).toEqual(["preview_start", "preview_stop", "preview_start"]);
		});

		it("does not loop when the second start is still expired", async () => {
			const expired = { status: "rejected", reason: "preview_url_unavailable" };
			runWorkspaceActionMock
				.mockResolvedValueOnce(expired)
				.mockResolvedValueOnce({ status: "preview_stopped", generation: 1 })
				.mockResolvedValueOnce(expired);
			renderCandidate();
			clickStart();
			expect(
				await screen.findByText(
					"The preview address expired. Try again shortly.",
				),
			).toBeTruthy();
			expect(runWorkspaceActionMock).toHaveBeenCalledTimes(3);
		});

		it("hides Retry Backup for candidate sessions", async () => {
			runWorkspaceActionMock.mockResolvedValueOnce({ status: "unknown" });
			renderCandidate({
				recovery: { state: "failed", reasonCode: null, pending: false },
			});
			clickStart();
			await screen.findByRole("alert");
			expect(screen.queryByRole("button", { name: "Retry Backup" })).toBeNull();
		});

		it("stop success removes the iframe", async () => {
			runWorkspaceActionMock
				.mockResolvedValueOnce(running)
				.mockResolvedValueOnce({ status: "preview_stopped", generation: 1 });
			renderCandidate();
			clickStart();
			await screen.findByTitle("Session website preview");
			fireEvent.click(screen.getByRole("button", { name: "Stop preview" }));
			await waitFor(() => {
				expect(screen.queryByTitle("Session website preview")).toBeNull();
			});
			expect(stopMutate).not.toHaveBeenCalled();
		});

		it("stop rejection keeps the iframe and shows the message", async () => {
			runWorkspaceActionMock
				.mockResolvedValueOnce(running)
				.mockResolvedValueOnce({ status: "rejected", reason: "x" });
			renderCandidate();
			clickStart();
			await screen.findByTitle("Session website preview");
			fireEvent.click(screen.getByRole("button", { name: "Stop preview" }));
			expect((await screen.findByRole("alert")).textContent).toMatch(
				/Preview failed to start\./,
			);
			expect(screen.getByTitle("Session website preview")).toBeTruthy();
		});

		it("legacy mode never calls workspace actions", async () => {
			render(<SessionPreviewPane projectId="proj-1" sessionId="sess-1" />);
			clickStart();
			await screen.findByTitle("Session website preview");
			expect(runWorkspaceActionMock).not.toHaveBeenCalled();
		});
	});
});
