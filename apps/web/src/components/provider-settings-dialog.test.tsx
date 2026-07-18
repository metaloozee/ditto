/** @vitest-environment jsdom */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
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
		}),
		useQueryClient: () => ({
			invalidateQueries: vi.fn(),
		}),
	};
});

vi.mock("#/components/ui/dialog", () => ({
	Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
		open ? <div>{children}</div> : null,
	DialogContent: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	DialogHeader: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	DialogTitle: ({ children }: { children: React.ReactNode }) => (
		<h2>{children}</h2>
	),
	DialogDescription: ({ children }: { children: React.ReactNode }) => (
		<p>{children}</p>
	),
	DialogFooter: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
}));

import { ProviderSettingsDialog } from "./provider-settings-dialog";

describe("ProviderSettingsDialog", () => {
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

	it("states account-level scope", () => {
		render(<ProviderSettingsDialog open onOpenChange={() => undefined} />);
		expect(
			screen.getByText(/apply to all of your projects and sandboxes/i),
		).toBeTruthy();
	});

	it("shows Anthropic manual paste and extra-usage caveat", () => {
		render(<ProviderSettingsDialog open onOpenChange={() => undefined} />);
		expect(screen.getByText(/extra usage billed/i)).toBeTruthy();
		expect(screen.getByText(/localhost redirect/i)).toBeTruthy();
	});

	it("renders API-key secret prompt as password and clears on close", async () => {
		streamMock.mockImplementation(async ({ onEvent }) => {
			onEvent({
				event: "meta",
				data: { attemptId: "att-1", providerId: "openai" },
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

		const onOpenChange = vi.fn();
		const { rerender } = render(
			<ProviderSettingsDialog open onOpenChange={onOpenChange} />,
		);

		fireEvent.click(screen.getAllByRole("button", { name: "API key" })[0]!);
		await waitFor(() => {
			expect(screen.getByLabelText(/Enter API key/i)).toBeTruthy();
		});
		const input = screen.getByLabelText(/Enter API key/i) as HTMLInputElement;
		expect(input.type).toBe("password");
		fireEvent.change(input, { target: { value: "sk-secret-value-xxxx" } });
		expect(input.value).toBe("sk-secret-value-xxxx");

		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		await waitFor(() => {
			expect(cancelMock).toHaveBeenCalledWith({ attemptId: "att-1" });
		});

		rerender(
			<ProviderSettingsDialog open={false} onOpenChange={onOpenChange} />,
		);
		rerender(<ProviderSettingsDialog open onOpenChange={onOpenChange} />);
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

		render(<ProviderSettingsDialog open onOpenChange={() => undefined} />);
		fireEvent.click(screen.getByRole("button", { name: "ChatGPT" }));
		await waitFor(() => {
			expect(screen.getByText("ABCD-EFGH")).toBeTruthy();
		});
		fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ABCD-EFGH");
		const link = screen.getByRole("link");
		expect(link.getAttribute("href")).toBe("https://auth.openai.com/device");
	});

	it("requires disconnect confirmation", async () => {
		render(<ProviderSettingsDialog open onOpenChange={() => undefined} />);
		fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
		expect(screen.getByText(/Upstream token revocation/i)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Confirm disconnect" }));
		await waitFor(() => {
			expect(disconnectMutate).toHaveBeenCalledWith({ providerId: "openai" });
		});
	});

	it("cancel path calls cancelProviderAuth", async () => {
		streamMock.mockImplementation(async ({ onEvent }) => {
			onEvent({
				event: "meta",
				data: { attemptId: "att-3", providerId: "openai" },
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
		render(<ProviderSettingsDialog open onOpenChange={() => undefined} />);
		fireEvent.click(screen.getAllByRole("button", { name: "API key" })[0]!);
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

		render(<ProviderSettingsDialog open onOpenChange={() => undefined} />);
		fireEvent.click(screen.getByRole("button", { name: "ChatGPT" }));
		await waitFor(() => {
			expect(screen.getByText("Connected.")).toBeTruthy();
		});
		expect(screen.queryByText("ZZZZ-YYYY")).toBeNull();
		expect(screen.queryByLabelText(/Paste code/i)).toBeNull();
		expect(screen.queryByRole("link")).toBeNull();
	});
});
