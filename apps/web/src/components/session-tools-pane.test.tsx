/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("#/components/session-preview-pane", () => ({
	SessionPreviewPane: ({
		projectId,
		sessionId,
	}: {
		projectId: string;
		sessionId: string;
	}) => (
		<div data-testid="preview-pane">
			{projectId}:{sessionId}
		</div>
	),
}));

const { SessionToolsPane } = await import("./session-tools-pane");

afterEach(() => {
	cleanup();
});

describe("SessionToolsPane", () => {
	it("renders browser chrome with Preview active and Terminal/Code disabled", () => {
		const { container } = render(
			<SessionToolsPane projectId="proj-1" sessionId="sess-1" />,
		);

		const pane = screen.getByRole("region", { name: "Session tools" });
		expect(pane.className).toContain("bg-muted");
		expect(pane.className).toContain("rounded-lg");
		expect(pane.className).toContain("border");

		const preview = screen.getByRole("tab", { name: /preview/i });
		const terminal = screen.getByRole("tab", { name: /terminal/i });
		const code = screen.getByRole("tab", { name: /code/i });

		expect(
			preview.getAttribute("aria-selected") ||
				preview.getAttribute("data-active"),
		).toBeTruthy();
		expect(
			terminal.getAttribute("aria-disabled") === "true" ||
				terminal.hasAttribute("data-disabled") ||
				(terminal as HTMLButtonElement).disabled,
		).toBe(true);
		expect(
			code.getAttribute("aria-disabled") === "true" ||
				code.hasAttribute("data-disabled") ||
				(code as HTMLButtonElement).disabled,
		).toBe(true);

		expect(screen.getByTestId("preview-pane").textContent).toBe(
			"proj-1:sess-1",
		);
		expect(container.querySelector("[aria-label='Session tools']")).toBe(pane);
	});

	it("closes only from the red window light", () => {
		const onClose = vi.fn();
		render(
			<SessionToolsPane
				projectId="proj-1"
				sessionId="sess-1"
				onClose={onClose}
			/>,
		);
		expect(screen.queryByRole("button", { name: "Session tools" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Close tools panel" }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("hides close control when onClose is omitted", () => {
		render(<SessionToolsPane projectId="proj-1" sessionId="sess-1" />);
		expect(
			screen.queryByRole("button", { name: "Close tools panel" }),
		).toBeNull();
	});
});
