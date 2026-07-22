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
	}),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useMutation: (options: {
			mutationFn: (input: unknown) => Promise<unknown>;
		}) => ({
			mutate: (input: unknown) => {
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

	it("restarts by discarding url then replacing on success", async () => {
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
		fireEvent.click(screen.getByRole("button", { name: "Restart preview" }));
		await waitFor(() => {
			expect(startMutate).toHaveBeenCalledTimes(2);
		});
		const second = await screen.findByTitle("Session website preview");
		expect(second.getAttribute("src")).toBe("https://10001-box-token.ayn.wtf");
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

	it("clears stop error on restart", async () => {
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
		fireEvent.click(screen.getByRole("button", { name: "Restart preview" }));
		await waitFor(() => {
			expect(screen.queryByRole("alert")).toBeNull();
		});
		await screen.findByTitle("Session website preview");
	});
});
