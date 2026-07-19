/** @vitest-environment jsdom */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const streamMock = vi.hoisted(() => vi.fn());
const answerMock = vi.hoisted(() => vi.fn());
const cancelMock = vi.hoisted(() => vi.fn());
const disconnectMutate = vi.hoisted(() => vi.fn());

vi.mock("#/lib/provider-auth-client", async () => {
	const actual = await vi.importActual<
		typeof import("#/lib/provider-auth-client")
	>("#/lib/provider-auth-client");
	return {
		...actual,
		streamProviderAuthLogin: streamMock,
		answerProviderAuthPrompt: answerMock,
		cancelProviderAuth: cancelMock,
	};
});

vi.mock("#/integrations/trpc/react", () => ({
	useTRPC: () => ({
		providerAuth: {
			catalog: {
				queryOptions: () => ({ queryKey: ["catalog"] }),
			},
			connections: {
				queryOptions: () => ({ queryKey: ["connections"] }),
				queryFilter: () => ({ queryKey: ["connections"] }),
			},
			models: {
				queryFilter: () => ({ queryKey: ["models"] }),
			},
			disconnect: {
				mutationOptions: (opts?: { onSuccess?: () => void }) => ({
					mutationFn: disconnectMutate,
					...opts,
				}),
			},
		},
	}),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useQuery: ({ queryKey }: { queryKey: string[] }) => {
			if (queryKey[0] === "catalog") {
				return {
					data: {
						providers: [
							{
								providerId: "openai",
								name: "OpenAI",
								authMethods: [{ type: "api_key", label: "API key" }],
							},
							{
								providerId: "anthropic",
								name: "Anthropic",
								authMethods: [
									{ type: "api_key", label: "API key" },
									{ type: "oauth", label: "Claude" },
								],
							},
							{
								providerId: "openai-codex",
								name: "Codex",
								authMethods: [{ type: "oauth", label: "ChatGPT" }],
							},
						],
					},
					isLoading: false,
				};
			}
			return {
				data: {
					connections: [
						{
							providerId: "openai",
							authType: "api_key",
							status: "connected",
							lastErrorCode: null,
							models: [],
						},
					],
				},
				isLoading: false,
			};
		},
		useMutation: (opts: {
			mutationFn?: (input: unknown) => Promise<unknown>;
			onSuccess?: () => void;
		}) => ({
			mutateAsync: async (input: unknown) => {
				await opts.mutationFn?.(input);
				await opts.onSuccess?.();
			},
			isPending: false,
			error: null,
			reset: vi.fn(),
		}),
		useQueryClient: () => ({
			invalidateQueries: vi.fn(),
		}),
	};
});

vi.mock("#/components/ui/alert-dialog", () => ({
	AlertDialog: ({
		open,
		children,
	}: {
		open: boolean;
		children: React.ReactNode;
	}) => (open ? <div role="alertdialog">{children}</div> : null),
	AlertDialogContent: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogHeader: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogTitle: ({ children }: { children: React.ReactNode }) => (
		<h2>{children}</h2>
	),
	AlertDialogDescription: ({ children }: { children: React.ReactNode }) => (
		<p>{children}</p>
	),
	AlertDialogFooter: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogAction: ({
		children,
		...props
	}: React.ComponentProps<"button">) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
	AlertDialogCancel: ({
		children,
		...props
	}: React.ComponentProps<"button">) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
}));

import { ProviderSettingsPage } from "./provider-settings-page";

describe("ProviderSettingsPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		cancelMock.mockResolvedValue(undefined);
		answerMock.mockResolvedValue({ accepted: true });
		streamMock.mockImplementation(async () => undefined);
		Object.assign(navigator, {
			clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
		});
	});

	afterEach(() => {
		cleanup();
	});

	it("renders dedicated account settings without dialog chrome", () => {
		render(<ProviderSettingsPage />);
		expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(
			screen.getByText(/across all of your projects and sandboxes/i),
		).toBeTruthy();
	});

	it("shows Anthropic manual paste and extra-usage caveat", () => {
		render(<ProviderSettingsPage />);
		expect(screen.getByText(/extra usage billed/i)).toBeTruthy();
		expect(screen.getByText(/localhost redirect/i)).toBeTruthy();
	});

	it("renders API-key secret prompt as password and clears on unmount", async () => {
		streamMock.mockImplementation(async ({ onEvent }) => {
			onEvent({
				event: "meta",
				data: { attemptId: "att-1", providerId: "anthropic" },
			});
			onEvent({
				event: "prompt",
				data: {
					promptId: "p1",
					type: "secret",
					message: "Enter API key",
				},
			});
			await new Promise(() => undefined);
		});

		const { unmount } = render(<ProviderSettingsPage />);
		// OpenAI is already connected — only unconnected providers show connect actions.
		fireEvent.click(screen.getByRole("button", { name: "API key" }));
		await waitFor(() => {
			expect(screen.getByLabelText(/Enter API key/i)).toBeTruthy();
		});
		const input = screen.getByLabelText(/Enter API key/i) as HTMLInputElement;
		expect(input.type).toBe("password");
		fireEvent.change(input, { target: { value: "sk-secret-value-xxxx" } });
		expect(input.value).toBe("sk-secret-value-xxxx");

		unmount();
		await waitFor(() => {
			expect(cancelMock).toHaveBeenCalledWith({ attemptId: "att-1" });
		});

		render(<ProviderSettingsPage />);
		expect(screen.queryByDisplayValue("sk-secret-value-xxxx")).toBeNull();
	});

	it("renders device code with copy and only clickable https links", async () => {
		streamMock.mockImplementation(async ({ onEvent }) => {
			onEvent({
				event: "meta",
				data: { attemptId: "att-2", providerId: "openai-codex" },
			});
			onEvent({
				event: "device_code",
				data: {
					userCode: "ABCD-EFGH",
					verificationUri: "https://auth.openai.com/device",
					clickable: true,
				},
			});
		});

		render(<ProviderSettingsPage />);
		fireEvent.click(screen.getByRole("button", { name: "ChatGPT" }));
		await waitFor(() => {
			expect(screen.getByText("ABCD-EFGH")).toBeTruthy();
		});
		expect(
			screen.getByRole("heading", { name: "Connect ChatGPT" }),
		).toBeTruthy();
		expect(screen.getByText("1 · Copy verification code")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ABCD-EFGH");
		const link = screen.getByRole("link", { name: /Open sign-in page/i });
		expect(link.getAttribute("href")).toBe("https://auth.openai.com/device");
	});

	it("connected providers only show disconnect", () => {
		render(<ProviderSettingsPage />);
		expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
		// OpenAI is connected — no reconnect/connect actions for it.
		expect(screen.queryByRole("button", { name: /Reconnect/i })).toBeNull();
		expect(screen.getAllByRole("button", { name: "API key" })).toHaveLength(1);
	});

	it("requires disconnect confirmation", async () => {
		render(<ProviderSettingsPage />);
		fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
		expect(screen.getByText(/Upstream token revocation/i)).toBeTruthy();
		fireEvent.click(
			within(screen.getByRole("alertdialog")).getByRole("button", {
				name: "Disconnect",
			}),
		);
		await waitFor(() => {
			expect(disconnectMutate).toHaveBeenCalledWith({ providerId: "openai" });
		});
	});

	it("cancel path calls cancelProviderAuth", async () => {
		streamMock.mockImplementation(async ({ onEvent }) => {
			onEvent({
				event: "meta",
				data: { attemptId: "att-3", providerId: "anthropic" },
			});
			onEvent({
				event: "prompt",
				data: {
					promptId: "p1",
					type: "secret",
					message: "Enter API key",
				},
			});
			await new Promise(() => undefined);
		});
		render(<ProviderSettingsPage />);
		fireEvent.click(screen.getByRole("button", { name: "API key" }));
		await waitFor(() => screen.getByRole("button", { name: "Cancel" }));
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => {
			expect(cancelMock).toHaveBeenCalledWith({ attemptId: "att-3" });
		});
	});

	it("clears device/auth/prompt remnants after done", async () => {
		streamMock.mockImplementation(async ({ onEvent }) => {
			onEvent({
				event: "meta",
				data: { attemptId: "att-done", providerId: "openai-codex" },
			});
			onEvent({
				event: "device_code",
				data: {
					userCode: "ZZZZ-YYYY",
					verificationUri: "https://auth.openai.com/device",
					clickable: true,
				},
			});
			onEvent({
				event: "prompt",
				data: {
					promptId: "p-done",
					type: "secret",
					message: "Paste code",
				},
			});
			onEvent({ event: "done", data: { ok: true } });
		});

		render(<ProviderSettingsPage />);
		fireEvent.click(screen.getByRole("button", { name: "ChatGPT" }));
		await waitFor(() => {
			expect(screen.queryByText("ZZZZ-YYYY")).toBeNull();
		});
		expect(screen.queryByLabelText(/Paste code/i)).toBeNull();
		expect(
			screen.queryByRole("link", { name: /auth\.openai\.com/i }),
		).toBeNull();
		expect(screen.queryByRole("dialog")).toBeNull();
	});
});
