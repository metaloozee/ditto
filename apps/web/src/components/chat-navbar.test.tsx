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

describe("ChatNavbar tools toggle", () => {
	it("places tools trigger after git actions when tools are closed", () => {
		render(
			<ChatNavbar
				projectId="proj-1"
				sessionId="sess-1"
				gitExportEnabled
				toolsOpen={false}
				onToolsOpenChange={() => undefined}
			/>,
		);

		const toggle = screen.getByRole("button", { name: "Session tools" });
		expect(toggle.getAttribute("aria-pressed")).toBe("false");
		expect(toggle.className).toContain("size-6");
		expect(screen.getByTestId("git-actions")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Preview" })).toBeNull();
		expect(screen.queryByText("Terminal")).toBeNull();
		expect(screen.queryByText("Code")).toBeNull();
	});

	it("hides tools trigger in navbar when tools are open", () => {
		render(
			<ChatNavbar
				projectId="proj-1"
				sessionId="sess-1"
				toolsOpen
				onToolsOpenChange={() => undefined}
			/>,
		);
		expect(screen.queryByRole("button", { name: "Session tools" })).toBeNull();
	});

	it("renders tools trigger even when git actions are unavailable", () => {
		render(
			<ChatNavbar
				projectId="proj-1"
				sessionId="sess-1"
				gitExportEnabled={false}
				toolsOpen={false}
				onToolsOpenChange={() => undefined}
			/>,
		);
		expect(screen.getByRole("button", { name: "Session tools" })).toBeTruthy();
		expect(screen.queryByTestId("git-actions")).toBeNull();
	});

	it("disables tools trigger only when no session exists", () => {
		const onChange = vi.fn();
		const { rerender } = render(
			<ChatNavbar
				projectId="proj-1"
				sessionId={null}
				toolsOpen={false}
				onToolsOpenChange={onChange}
			/>,
		);
		expect(
			(
				screen.getByRole("button", {
					name: "Session tools",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);

		rerender(
			<ChatNavbar
				projectId="proj-1"
				sessionId="sess-1"
				toolsOpen={false}
				onToolsOpenChange={onChange}
			/>,
		);
		const toggle = screen.getByRole("button", {
			name: "Session tools",
		}) as HTMLButtonElement;
		expect(toggle.disabled).toBe(false);
		fireEvent.click(toggle);
		expect(onChange).toHaveBeenCalledWith(true);
	});
});
