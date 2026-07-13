/** @vitest-environment jsdom */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerStreamingState } from "./composer";

const streamAgentRunMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/agent-stream-client", () => ({
	streamAgentRun: streamAgentRunMock,
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

vi.mock("#/components/session-git-actions", () => ({
	SessionGitActions: () => null,
}));

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

		// done.content is preferred at commit; streaming text uses partsToText
		// which joins text segments around tools with \n\n.
		const doneContent = `${fullText} after-tool`;
		const projectedText = `${fullText}\n\n after-tool`;
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
});
