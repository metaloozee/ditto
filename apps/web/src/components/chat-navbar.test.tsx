/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("#/components/session-git-actions", () => ({
	SessionGitActions: ({ children }: { children?: React.ReactNode }) => (
		<div data-testid="git-actions">{children}</div>
	),
}));

vi.mock("#/components/ui/sidebar", () => ({
	SidebarTrigger: () => <button type="button">Sidebar</button>,
	useSidebar: () => ({ state: "expanded" }),
}));

const { ChatNavbar } = await import("./chat-navbar");

afterEach(() => {
	cleanup();
});

describe("ChatNavbar preview toggle", () => {
	it("places Preview after git actions and keeps Terminal/Code disabled", () => {
		render(
			<ChatNavbar
				projectId="proj-1"
				sessionId="sess-1"
				gitExportEnabled
				previewOpen={false}
				onPreviewOpenChange={() => undefined}
			/>,
		);

		const preview = screen.getByRole("button", { name: "Preview" });
		expect(preview.getAttribute("aria-pressed")).toBe("false");
		expect(screen.getByTestId("git-actions")).toBeTruthy();
		expect(
			screen.getByText("Terminal").closest("[aria-disabled='true']"),
		).toBeTruthy();
		expect(
			screen.getByText("Code").closest("[aria-disabled='true']"),
		).toBeTruthy();
	});

	it("renders Preview even when git actions are unavailable", () => {
		render(
			<ChatNavbar
				projectId="proj-1"
				sessionId="sess-1"
				gitExportEnabled={false}
				previewOpen={false}
				onPreviewOpenChange={() => undefined}
			/>,
		);
		expect(screen.getByRole("button", { name: "Preview" })).toBeTruthy();
		expect(screen.queryByTestId("git-actions")).toBeNull();
	});

	it("disables Preview only when no session exists", () => {
		const onChange = vi.fn();
		const { rerender } = render(
			<ChatNavbar
				projectId="proj-1"
				sessionId={null}
				previewOpen={false}
				onPreviewOpenChange={onChange}
			/>,
		);
		expect(
			(screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);

		rerender(
			<ChatNavbar
				projectId="proj-1"
				sessionId="sess-1"
				previewOpen={false}
				onPreviewOpenChange={onChange}
			/>,
		);
		const toggle = screen.getByRole("button", {
			name: "Preview",
		}) as HTMLButtonElement;
		expect(toggle.disabled).toBe(false);
		fireEvent.click(toggle);
		expect(onChange).toHaveBeenCalledWith(true);
	});

	it("closing preview only toggles open state (no stop)", () => {
		const onChange = vi.fn();
		render(
			<ChatNavbar
				projectId="proj-1"
				sessionId="sess-1"
				previewOpen
				onPreviewOpenChange={onChange}
			/>,
		);
		const toggle = screen.getByRole("button", { name: "Preview" });
		expect(toggle.getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(toggle);
		expect(onChange).toHaveBeenCalledWith(false);
		expect(onChange).toHaveBeenCalledTimes(1);
	});
});
