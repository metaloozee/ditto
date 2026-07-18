/** @vitest-environment jsdom */

import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStreamHandlers } from "#/lib/agent-stream-client";
import type { ComposerStreamingState } from "./composer";

const streamAgentRunMock = vi.hoisted(() => vi.fn());
const sendAgentControlMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/agent-stream-client", () => ({
	sendAgentControl: sendAgentControlMock,
	streamAgentRun: streamAgentRunMock,
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
}));

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
		success: vi.fn(),
	},
}));

vi.mock("#/integrations/trpc/react", () => ({
	useTRPC: () => ({
		providerAuth: {
			models: {
				queryOptions: () => ({
					queryKey: ["providerAuth", "models"],
				}),
			},
		},
	}),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useQuery: () => ({
			data: {
				models: [
					{
						id: "opencode/deepseek-v4-flash-free",
						name: "DeepSeek V4 Flash Free",
						provider: "opencode",
						providerName: "OpenCode Zen",
					},
				],
			},
			isLoading: false,
		}),
	};
});

vi.mock("#/components/ai-elements/model-selector", () => ({
	ModelSelector: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	ModelSelectorContent: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	ModelSelectorEmpty: () => null,
	ModelSelectorGroup: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	ModelSelectorInput: () => null,
	ModelSelectorItem: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	ModelSelectorList: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	ModelSelectorLogo: () => null,
	ModelSelectorLogoGroup: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	ModelSelectorName: ({ children }: { children: React.ReactNode }) => (
		<span>{children}</span>
	),
	ModelSelectorTrigger: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
}));

const { Composer } = await import("./composer");

function createPendingStream() {
	const state: {
		handlers?: AgentStreamHandlers;
		resolve?: () => void;
	} = {};
	streamAgentRunMock.mockImplementation(
		(_input: unknown, handlers: AgentStreamHandlers) => {
			state.handlers = handlers;
			handlers.onMeta?.({
				runId: "run-1",
				sessionId: "sess-1",
				userMessageId: "user-1",
				assistantMessageId: "asst-1",
				createdSession: false,
				sandboxState: "ready",
			});
			return new Promise<void>((resolve) => {
				state.resolve = resolve;
			});
		},
	);
	return state;
}

function followUpResponse(index: number) {
	return {
		accepted: true as const,
		action: "follow_up" as const,
		requestId: `request-${index}`,
		runId: "run-1",
		sessionId: "sess-1",
		userMessageId: `user-${index + 1}`,
		assistantMessageId: `asst-${index + 1}`,
	};
}

describe("Composer streaming updates", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it("submits text with Enter", async () => {
		streamAgentRunMock.mockImplementation(async (_input, handlers) => {
			handlers.onDone?.({ ok: true, content: "", assistantMessageId: null });
		});

		render(<Composer projectId="proj-1" sessionId="sess-1" />);

		const textarea = screen.getByRole("textbox");
		fireEvent.change(textarea, { target: { value: "hello" } });
		fireEvent.keyDown(textarea, { key: "Enter" });

		await waitFor(() => {
			expect(streamAgentRunMock).toHaveBeenCalledWith(
				expect.objectContaining({ message: "hello" }),
				expect.any(Object),
			);
		});
	});

	it("bounds onStreamingChange calls for many deltas while preserving order", async () => {
		const tokens = Array.from({ length: 100 }, (_, i) => `t${i}`);
		const fullText = tokens.join("");
		const streamingSnapshots: ComposerStreamingState[] = [];
		let streamingChangeCalls = 0;

		streamAgentRunMock.mockImplementation(async (_input, handlers) => {
			handlers.onMeta?.({
				sessionId: "sess-1",
				userMessageId: "user-1",
				assistantMessageId: "asst-1",
				createdSession: false,
			});
			for (const token of tokens) {
				handlers.onDelta?.(token);
			}
			handlers.onAgent?.({
				type: "tool_execution_start",
				toolCallId: "tool-1",
				toolName: "bash",
				args: { command: "ls" },
			});
			handlers.onAgent?.({
				type: "tool_execution_end",
				toolCallId: "tool-1",
				toolName: "bash",
				result: "ok",
				isError: false,
			});
			handlers.onDelta?.(" after-tool");
			handlers.onDone?.({
				ok: true,
				assistantMessageId: "asst-1",
				content: `${fullText} after-tool`,
			});
		});

		const onStreamCommit = vi.fn();
		render(
			<Composer
				projectId="proj-1"
				sessionId="sess-1"
				onStreamingChange={(update) => {
					streamingChangeCalls += 1;
					if (typeof update === "function") {
						const next = update(
							streamingSnapshots.at(-1) ?? {
								active: true,
								text: "",
								userText: "hello",
								tools: [],
								parts: [],
								queuedFollowUps: [],
							},
						);
						if (next) {
							streamingSnapshots.push(next);
						}
					} else if (update) {
						streamingSnapshots.push(update);
					}
				}}
				onStreamCommit={onStreamCommit}
			/>,
		);

		const textarea = screen.getByRole("textbox");
		fireEvent.change(textarea, { target: { value: "hello" } });
		const form = textarea.closest("form");
		expect(form).toBeTruthy();
		fireEvent.submit(form as HTMLFormElement);

		await waitFor(() => {
			expect(onStreamCommit).toHaveBeenCalledTimes(1);
		});

		// done.content and streaming text preserve the original delta bytes.
		const doneContent = `${fullText} after-tool`;
		const projectedText = doneContent;
		expect(onStreamCommit.mock.calls[0]?.[0]).toMatchObject({
			sessionId: "sess-1",
			assistant: {
				id: "asst-1",
				content: doneContent,
			},
		});
		const committedTools =
			onStreamCommit.mock.calls[0]?.[0]?.assistant?.tools ?? [];
		expect(committedTools.some((t: { id: string }) => t.id === "tool-1")).toBe(
			true,
		);

		// Bound: one initial emptyStreaming + meta + ≤N deltas + tool events + clear.
		// Enforce ≤ deltas + meta/tool/done overhead (not quadratic growth).
		const deltaCount = tokens.length + 1; // + after-tool
		const toolEvents = 2;
		const overhead = 4; // emptyStreaming, meta, clearStreaming(null), slack
		expect(streamingChangeCalls).toBeLessThanOrEqual(
			deltaCount + toolEvents + overhead,
		);
		expect(streamingChangeCalls).toBeGreaterThan(0);

		const lastActive = [...streamingSnapshots]
			.reverse()
			.find((s) => s.active && s.text.length > 0);
		expect(lastActive?.text).toBe(projectedText);
		expect(lastActive?.tools.some((t) => t.id === "tool-1")).toBe(true);
	});

	it("settles once when error and done both arrive", async () => {
		const onStreamCommit = vi.fn();
		streamAgentRunMock.mockImplementation(async (_input, handlers) => {
			handlers.onMeta?.({
				sessionId: "sess-1",
				userMessageId: "user-1",
				assistantMessageId: "asst-1",
				createdSession: false,
			});
			handlers.onDelta?.("partial");
			handlers.onError?.("boom");
			handlers.onDone?.({
				ok: false,
				assistantMessageId: "asst-1",
				content: "partial",
			});
		});

		render(
			<Composer
				projectId="proj-1"
				sessionId="sess-1"
				onStreamCommit={onStreamCommit}
			/>,
		);

		const textarea = screen.getByRole("textbox");
		fireEvent.change(textarea, { target: { value: "hello" } });
		const form = textarea.closest("form");
		fireEvent.submit(form as HTMLFormElement);

		await waitFor(() => {
			expect(onStreamCommit).toHaveBeenCalledTimes(1);
		});
		expect(onStreamCommit.mock.calls[0]?.[0]?.assistant?.content).toBe(
			"partial",
		);
	});

	it("preserves server tool lifecycle timestamps through onStreamCommit", async () => {
		const onStreamCommit = vi.fn();
		streamAgentRunMock.mockImplementation(async (_input, handlers) => {
			handlers.onMeta?.({
				sessionId: "sess-1",
				userMessageId: "user-1",
				assistantMessageId: "asst-1",
				createdSession: false,
			});
			handlers.onAgent?.(
				{
					type: "tool_execution_start",
					toolCallId: "tool-timed",
					toolName: "bash",
					args: { command: "ls" },
				},
				1_000,
			);
			handlers.onAgent?.(
				{
					type: "tool_execution_end",
					toolCallId: "tool-timed",
					toolName: "bash",
					result: "ok",
					isError: false,
				},
				5_000,
			);
			handlers.onDone?.({
				ok: true,
				assistantMessageId: "asst-1",
				content: "",
			});
		});

		render(
			<Composer
				projectId="proj-1"
				sessionId="sess-1"
				onStreamCommit={onStreamCommit}
			/>,
		);

		const textarea = screen.getByRole("textbox");
		fireEvent.change(textarea, { target: { value: "hello" } });
		const form = textarea.closest("form");
		fireEvent.submit(form as HTMLFormElement);

		await waitFor(() => {
			expect(onStreamCommit).toHaveBeenCalledTimes(1);
		});

		const tools = onStreamCommit.mock.calls[0]?.[0]?.assistant?.tools ?? [];
		expect(tools).toEqual([
			expect.objectContaining({
				id: "tool-timed",
				status: "done",
				startedAt: 1_000,
				endedAt: 5_000,
			}),
		]);
		const parts = onStreamCommit.mock.calls[0]?.[0]?.assistant?.parts ?? [];
		expect(parts[0]).toMatchObject({
			type: "tool",
			tool: {
				id: "tool-timed",
				startedAt: 1_000,
				endedAt: 5_000,
			},
		});
	});

	it("implements idle, starting, Queue message, and Stop button states", async () => {
		const stream = createPendingStream();
		render(<Composer projectId="proj-1" sessionId="sess-1" />);

		const textarea = screen.getByRole("textbox", { name: "Message" });
		const submit = screen.getByRole("button", { name: "Submit" });
		expect((submit as HTMLButtonElement).disabled).toBe(true);
		fireEvent.change(textarea, { target: { value: "initial" } });
		expect((submit as HTMLButtonElement).disabled).toBe(false);
		fireEvent.submit(textarea.closest("form") as HTMLFormElement);

		await waitFor(() => {
			expect(
				(screen.getByRole("button", { name: "Starting" }) as HTMLButtonElement)
					.disabled,
			).toBe(true);
		});
		act(() => stream.handlers?.onControlReady?.({ runId: "run-1" }));
		const stop = screen.getByRole("button", { name: "Stop" });
		expect((stop as HTMLButtonElement).disabled).toBe(false);
		expect(stop.querySelector(".lucide-square")).not.toBeNull();

		fireEvent.change(textarea, { target: { value: "   " } });
		expect(
			(screen.getByRole("button", { name: "Stop" }) as HTMLButtonElement)
				.disabled,
		).toBe(false);
		fireEvent.change(textarea, { target: { value: "follow up" } });
		const queue = screen.getByRole("button", { name: "Queue message" });
		expect((queue as HTMLButtonElement).disabled).toBe(false);
		expect(queue.querySelector(".lucide-corner-down-left")).not.toBeNull();

		act(() => {
			stream.handlers?.onDone?.({
				ok: true,
				assistantMessageId: "asst-1",
				content: "done",
			});
			stream.resolve?.();
		});
	});

	it("preserves the draft until acknowledgement and does not erase newer typing", async () => {
		const stream = createPendingStream();
		let resolveControl:
			| ((value: ReturnType<typeof followUpResponse>) => void)
			| undefined;
		sendAgentControlMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveControl = resolve;
				}),
		);
		render(<Composer projectId="proj-1" sessionId="sess-1" />);
		const textarea = screen.getByRole("textbox", { name: "Message" });
		fireEvent.change(textarea, { target: { value: "initial" } });
		fireEvent.submit(textarea.closest("form") as HTMLFormElement);
		act(() => stream.handlers?.onControlReady?.({ runId: "run-1" }));

		fireEvent.change(textarea, { target: { value: "first follow-up" } });
		const form = textarea.closest("form") as HTMLFormElement;
		fireEvent.submit(form);
		fireEvent.submit(form);
		expect(sendAgentControlMock).toHaveBeenCalledTimes(1);
		expect((textarea as HTMLTextAreaElement).value).toBe("first follow-up");
		expect(
			(
				screen.getByRole("button", {
					name: "Queue message",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		fireEvent.change(textarea, { target: { value: "newer typing" } });
		await act(async () => resolveControl?.(followUpResponse(1)));
		expect((textarea as HTMLTextAreaElement).value).toBe("newer typing");
		expect(streamAgentRunMock).toHaveBeenCalledTimes(1);

		act(() => {
			stream.handlers?.onDone?.({
				ok: true,
				assistantMessageId: "asst-1",
				content: "done",
			});
			stream.resolve?.();
		});
	});

	it("clears an unchanged draft after acknowledgement and queues follow-ups FIFO", async () => {
		const stream = createPendingStream();
		sendAgentControlMock
			.mockResolvedValueOnce(followUpResponse(1))
			.mockResolvedValueOnce(followUpResponse(2));
		const snapshots: ComposerStreamingState[] = [];
		render(
			<Composer
				projectId="proj-1"
				sessionId="sess-1"
				onStreamingChange={(update) => {
					const previous = snapshots.at(-1) ?? null;
					const next = typeof update === "function" ? update(previous) : update;
					if (next) snapshots.push(next);
				}}
			/>,
		);
		const textarea = screen.getByRole("textbox", { name: "Message" });
		fireEvent.change(textarea, { target: { value: "initial" } });
		fireEvent.submit(textarea.closest("form") as HTMLFormElement);
		act(() => stream.handlers?.onControlReady?.({ runId: "run-1" }));

		for (const message of ["one", "two"]) {
			fireEvent.change(textarea, { target: { value: message } });
			fireEvent.submit(textarea.closest("form") as HTMLFormElement);
			await waitFor(() =>
				expect((textarea as HTMLTextAreaElement).value).toBe(""),
			);
		}
		expect(streamAgentRunMock).toHaveBeenCalledTimes(1);
		expect(snapshots.at(-1)?.queuedFollowUps.map((item) => item.text)).toEqual([
			"one",
			"two",
		]);

		act(() => {
			stream.handlers?.onDone?.({
				ok: true,
				assistantMessageId: "asst-1",
				content: "done",
			});
			stream.resolve?.();
		});
	});

	it("preserves a failed queue draft and reports one error", async () => {
		const stream = createPendingStream();
		sendAgentControlMock.mockRejectedValue(new Error("run settled"));
		render(<Composer projectId="proj-1" sessionId="sess-1" />);
		const textarea = screen.getByRole("textbox", { name: "Message" });
		fireEvent.change(textarea, { target: { value: "initial" } });
		fireEvent.submit(textarea.closest("form") as HTMLFormElement);
		act(() => stream.handlers?.onControlReady?.({ runId: "run-1" }));
		fireEvent.change(textarea, { target: { value: "keep me" } });
		fireEvent.submit(textarea.closest("form") as HTMLFormElement);

		await waitFor(() =>
			expect(toastErrorMock).toHaveBeenCalledWith("run settled"),
		);
		expect(toastErrorMock).toHaveBeenCalledTimes(1);
		expect((textarea as HTMLTextAreaElement).value).toBe("keep me");
		act(() => {
			stream.handlers?.onDone?.({
				ok: true,
				assistantMessageId: "asst-1",
				content: "done",
			});
			stream.resolve?.();
		});
	});

	it("commits turn_done once and promotes the matching queued turn", async () => {
		const stream = createPendingStream();
		sendAgentControlMock.mockResolvedValue(followUpResponse(1));
		const onStreamCommit = vi.fn();
		const snapshots: ComposerStreamingState[] = [];
		render(
			<Composer
				projectId="proj-1"
				sessionId="sess-1"
				onStreamCommit={onStreamCommit}
				onStreamingChange={(update) => {
					const previous = snapshots.at(-1) ?? null;
					const next = typeof update === "function" ? update(previous) : update;
					if (next) snapshots.push(next);
				}}
			/>,
		);
		const textarea = screen.getByRole("textbox", { name: "Message" });
		fireEvent.change(textarea, { target: { value: "initial" } });
		fireEvent.submit(textarea.closest("form") as HTMLFormElement);
		act(() => stream.handlers?.onControlReady?.({ runId: "run-1" }));
		fireEvent.change(textarea, { target: { value: "next" } });
		fireEvent.submit(textarea.closest("form") as HTMLFormElement);
		await waitFor(() =>
			expect((textarea as HTMLTextAreaElement).value).toBe(""),
		);

		act(() => {
			const turn = {
				userMessageId: "user-1",
				assistantMessageId: "asst-1",
				content: "first answer",
			};
			stream.handlers?.onTurnDone?.(turn);
			stream.handlers?.onTurnDone?.(turn);
			stream.handlers?.onTurnStart?.({
				requestId: "request-1",
				userMessageId: "user-2",
				assistantMessageId: "asst-2",
				text: "next",
			});
		});
		expect(onStreamCommit).toHaveBeenCalledTimes(1);
		expect(onStreamCommit).toHaveBeenCalledWith(
			expect.objectContaining({
				user: expect.objectContaining({ content: "initial" }),
				assistant: expect.objectContaining({ id: "asst-1" }),
			}),
		);
		expect(snapshots.at(-1)).toMatchObject({
			userText: "next",
			userMessageId: "user-2",
			assistantMessageId: "asst-2",
			queuedFollowUps: [],
		});

		act(() => {
			stream.handlers?.onDone?.({
				ok: true,
				assistantMessageId: "asst-2",
				content: "second answer",
			});
			stream.resolve?.();
		});
		await waitFor(() => expect(onStreamCommit).toHaveBeenCalledTimes(2));
	});

	it("does not append a phantom queue item when turn_start precedes HTTP acknowledgement", async () => {
		const stream = createPendingStream();
		let resolveControl:
			| ((value: ReturnType<typeof followUpResponse>) => void)
			| undefined;
		sendAgentControlMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveControl = resolve;
				}),
		);
		const onStreamCommit = vi.fn();
		let latest: ComposerStreamingState | null = null;
		render(
			<Composer
				projectId="proj-1"
				sessionId="sess-1"
				onStreamCommit={onStreamCommit}
				onStreamingChange={(update) => {
					latest = typeof update === "function" ? update(latest) : update;
				}}
			/>,
		);
		const textarea = screen.getByRole("textbox", { name: "Message" });
		fireEvent.change(textarea, { target: { value: "initial" } });
		fireEvent.submit(textarea.closest("form") as HTMLFormElement);
		act(() => stream.handlers?.onControlReady?.({ runId: "run-1" }));
		fireEvent.change(textarea, { target: { value: "next" } });
		fireEvent.submit(textarea.closest("form") as HTMLFormElement);

		act(() => {
			stream.handlers?.onTurnDone?.({
				userMessageId: "user-1",
				assistantMessageId: "asst-1",
				content: "first answer",
			});
			stream.handlers?.onTurnStart?.({
				requestId: "request-1",
				userMessageId: "user-2",
				assistantMessageId: "asst-2",
				text: "next",
			});
		});
		expect(latest).toMatchObject({
			userMessageId: "user-2",
			assistantMessageId: "asst-2",
			queuedFollowUps: [],
		});

		await act(async () => resolveControl?.(followUpResponse(1)));
		expect((textarea as HTMLTextAreaElement).value).toBe("");
		expect((latest as ComposerStreamingState | null)?.queuedFollowUps).toEqual(
			[],
		);
		expect(onStreamCommit).toHaveBeenCalledTimes(1);
		expect(streamAgentRunMock).toHaveBeenCalledTimes(1);

		act(() => {
			stream.handlers?.onDone?.({
				ok: true,
				assistantMessageId: "asst-2",
				content: "second answer",
			});
			stream.resolve?.();
		});
		await waitFor(() => expect(onStreamCommit).toHaveBeenCalledTimes(2));
	});

	it("ignores a follow-up acknowledgement that resolves after terminal SSE", async () => {
		const stream = createPendingStream();
		let resolveControl:
			| ((value: ReturnType<typeof followUpResponse>) => void)
			| undefined;
		sendAgentControlMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveControl = resolve;
				}),
		);
		let latest: ComposerStreamingState | null = null;
		render(
			<Composer
				projectId="proj-1"
				sessionId="sess-1"
				onStreamingChange={(update) => {
					latest = typeof update === "function" ? update(latest) : update;
				}}
			/>,
		);
		const textarea = screen.getByRole("textbox", { name: "Message" });
		fireEvent.change(textarea, { target: { value: "initial" } });
		fireEvent.submit(textarea.closest("form") as HTMLFormElement);
		act(() => stream.handlers?.onControlReady?.({ runId: "run-1" }));
		fireEvent.change(textarea, { target: { value: "keep after terminal" } });
		fireEvent.submit(textarea.closest("form") as HTMLFormElement);

		act(() => {
			stream.handlers?.onDone?.({
				ok: true,
				assistantMessageId: "asst-1",
				content: "done",
			});
			stream.resolve?.();
		});
		await waitFor(() => expect(latest).toBeNull());
		await act(async () => resolveControl?.(followUpResponse(1)));

		expect((textarea as HTMLTextAreaElement).value).toBe("keep after terminal");
		expect(latest).toBeNull();
		expect(toastErrorMock).not.toHaveBeenCalled();
		expect(streamAgentRunMock).toHaveBeenCalledTimes(1);
	});

	it("guards Stop double submission and waits for terminal SSE", async () => {
		const stream = createPendingStream();
		let resolveStop: ((value: unknown) => void) | undefined;
		sendAgentControlMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveStop = resolve;
				}),
		);
		render(<Composer projectId="proj-1" sessionId="sess-1" />);
		const textarea = screen.getByRole("textbox", { name: "Message" });
		fireEvent.change(textarea, { target: { value: "initial" } });
		fireEvent.submit(textarea.closest("form") as HTMLFormElement);
		act(() => stream.handlers?.onControlReady?.({ runId: "run-1" }));
		const form = textarea.closest("form") as HTMLFormElement;
		fireEvent.submit(form);
		fireEvent.submit(form);
		expect(sendAgentControlMock).toHaveBeenCalledTimes(1);
		expect(
			(screen.getByRole("button", { name: "Stopping" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);

		await act(async () =>
			resolveStop?.({
				accepted: true,
				action: "stop",
				requestId: "stop-1",
				runId: "run-1",
				sessionId: "sess-1",
				removedFollowUpCount: 0,
			}),
		);
		expect(
			(screen.getByRole("button", { name: "Stopping" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(streamAgentRunMock).toHaveBeenCalledTimes(1);

		act(() => {
			stream.handlers?.onDone?.({
				ok: false,
				assistantMessageId: "asst-1",
				content: "partial",
			});
			stream.resolve?.();
		});
		await waitFor(() =>
			expect(
				(screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement)
					.disabled,
			).toBe(true),
		);
	});
});
