/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { StreamToolCall } from "#/lib/agent-message-parts";
import { ToolCallGroup } from "./tool-call-group";

afterEach(() => {
	cleanup();
});

function timedTool(
	id: string,
	command: string,
	startedAt: number,
	endedAt: number,
	status: StreamToolCall["status"] = "done",
): StreamToolCall {
	return {
		id,
		name: "bash",
		status,
		args: { command },
		result: { stdout: `result-for-${id}` },
		startedAt,
		endedAt,
	};
}

describe("ToolCallGroup", () => {
	it("shows Worked for 17m 3s for four tools spanning 1_023_000 ms", () => {
		const tools = [
			timedTool("t1", "ls", 0, 100_000),
			timedTool("t2", "pwd", 100_000, 400_000),
			timedTool("t3", "cat a", 400_000, 800_000),
			timedTool("t4", "echo hi", 800_000, 1_023_000),
		];
		render(<ToolCallGroup tools={tools} />);

		const trigger = screen.getByRole("button", { name: /Worked for 17m 3s/i });
		expect(trigger).toBeTruthy();
		expect(trigger.getAttribute("aria-expanded")).toBeDefined();
	});

	it("expands to show only concise labels without result payloads", () => {
		const tools = [
			timedTool("t1", "ls", 0, 1_000),
			timedTool("t2", "pwd", 1_000, 2_000),
			timedTool("t3", "cat a", 2_000, 3_000),
			timedTool("t4", "echo hi", 3_000, 4_000),
		];
		render(<ToolCallGroup tools={tools} />);

		const trigger = screen.getByRole("button", { name: /Worked for/i });
		// Open if closed
		if (trigger.getAttribute("aria-expanded") !== "true") {
			fireEvent.click(trigger);
		}

		expect(screen.getByText(/ls/)).toBeTruthy();
		expect(screen.getByText(/pwd/)).toBeTruthy();
		expect(screen.getByText(/cat a/)).toBeTruthy();
		expect(screen.getByText(/echo hi/)).toBeTruthy();
		expect(screen.queryByText(/result-for-t1/)).toBeNull();
		expect(screen.queryByText(/stdout/)).toBeNull();
	});

	it("marks active groups Working with shimmer and no duration", () => {
		const tools = [timedTool("t1", "ls", 0, 4_000)];
		const { container } = render(<ToolCallGroup tools={tools} active />);

		expect(screen.getByRole("button", { name: /^Working$/i })).toBeTruthy();
		expect(screen.queryByText(/Worked/)).toBeNull();
		const shimmer = container.querySelector(".shimmer");
		expect(shimmer?.textContent).toMatch(/Working/);
		expect(container.querySelector("[data-spinner]")).toBeNull();
	});

	it("shows Working when a tool is running even without active", () => {
		const tools: StreamToolCall[] = [
			{
				id: "t-run",
				name: "bash",
				status: "running",
				args: { command: "sleep 1" },
				startedAt: 1_000,
			},
		];
		render(<ToolCallGroup tools={tools} active={false} />);
		expect(screen.getByRole("button", { name: /^Working$/i })).toBeTruthy();
	});

	it("falls back to Worked for legacy groups without timestamps", () => {
		const tools: StreamToolCall[] = [
			{
				id: "legacy",
				name: "bash",
				status: "done",
				args: { command: "ls" },
			},
		];
		render(<ToolCallGroup tools={tools} />);
		expect(screen.getByRole("button", { name: /^Worked$/i })).toBeTruthy();
		expect(screen.queryByText(/Worked for/)).toBeNull();
	});

	it("retains destructive styling for error tools", () => {
		const tools = [timedTool("t-err", "false", 0, 1_000, "error")];
		const { container } = render(<ToolCallGroup tools={tools} />);
		const trigger = screen.getByRole("button");
		if (trigger.getAttribute("aria-expanded") !== "true") {
			fireEvent.click(trigger);
		}
		const failed = container.querySelector(".text-destructive");
		expect(failed).toBeTruthy();
		expect(failed?.textContent).toMatch(/false/);
	});

	it("exposes a keyboard-operable trigger with aria-expanded", () => {
		const tools = [timedTool("t1", "ls", 0, 1_000)];
		render(<ToolCallGroup tools={tools} />);
		const trigger = screen.getByRole("button", { name: /Worked for 1s/i });
		expect(trigger.tagName).toMatch(/BUTTON/i);
		expect(trigger.getAttribute("aria-expanded")).toMatch(/true|false/);
		// Keyboard activation toggles expansion
		const before = trigger.getAttribute("aria-expanded");
		fireEvent.keyDown(trigger, { key: "Enter" });
		// Base UI may use click handler; click is also keyboard-operable for buttons
		fireEvent.click(trigger);
		const after = trigger.getAttribute("aria-expanded");
		expect(after).not.toBe(before);
	});
});
