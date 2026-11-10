/** @vitest-environment jsdom */

import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useCodexConnection } from "#/lib/candidate-session-client";

vi.stubGlobal(
	"ResizeObserver",
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
);
HTMLElement.prototype.scrollIntoView = vi.fn();
HTMLElement.prototype.getAnimations = vi.fn(() => []);

const toastAddMock = vi.hoisted(() => vi.fn());
vi.mock("#/components/ui/toast", () => ({ toast: { add: toastAddMock } }));

const { CodexConnectDialog } = await import("./codex-connect-dialog");

type Codex = ReturnType<typeof useCodexConnection>;
const URI = "https://auth.openai.com/codex/device";
const NOW = new Date("2026-11-10T12:00:00Z").getTime();
const PRIMARY = "Copy code and open OpenAI ↗";

function makeCodex(overrides: Partial<Codex> = {}): Codex {
	return {
		status: "pending",
		isPending: false,
		actionPending: false,
		deviceAuth: {
			status: "pending",
			generation: 1,
			userCode: "ABCD-1234",
			verificationUri: URI,
			expiresAt: NOW + 15 * 60 * 1000,
		},
		lastErrorCode: null,
		clearDeviceAuth: vi.fn(),
		runAction: vi.fn(),
		...overrides,
	};
}

describe("CodexConnectDialog", () => {
	let writeText: ReturnType<typeof vi.fn>;
	let windowOpen: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		vi.clearAllMocks();
		writeText = vi.fn().mockResolvedValue(undefined);
		windowOpen = vi.fn();
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		vi.stubGlobal("open", windowOpen);
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("shows the code, the primary button and a ticking countdown", () => {
		render(
			<CodexConnectDialog open onOpenChange={vi.fn()} codex={makeCodex()} />,
		);
		expect(screen.getByText("ABCD-1234")).toBeTruthy();
		expect(screen.getByRole("button", { name: PRIMARY })).toBeTruthy();
		expect(screen.getByText("15:00")).toBeTruthy();
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(screen.getByText("14:59")).toBeTruthy();
	});

	it("expires at zero and requests a new code", () => {
		const codex = makeCodex();
		render(<CodexConnectDialog open onOpenChange={vi.fn()} codex={codex} />);
		act(() => {
			vi.advanceTimersByTime(15 * 60 * 1000);
		});
		expect(screen.getByText("This code expired.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Get a new code" }));
		expect(codex.runAction).toHaveBeenCalledWith("connect");
	});

	it("closes with a toast once connected", () => {
		const onOpenChange = vi.fn();
		const codex = makeCodex({ status: "connected" });
		render(
			<CodexConnectDialog open onOpenChange={onOpenChange} codex={codex} />,
		);
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(toastAddMock).toHaveBeenCalledWith({
			description: "Codex connected.",
		});
		expect(codex.clearDeviceAuth).toHaveBeenCalled();
	});

	it("shows the failed state on reconnect_required", () => {
		const codex = makeCodex({ status: "reconnect_required" });
		render(<CodexConnectDialog open onOpenChange={vi.fn()} codex={codex} />);
		expect(screen.getByText("Sign-in didn't complete.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(codex.runAction).toHaveBeenCalledWith("connect");
	});

	it("shows the unavailable copy and no code", () => {
		const codex = makeCodex({
			deviceAuth: null,
			status: "disconnected",
			lastErrorCode: "codex_device_auth_unavailable",
		});
		render(<CodexConnectDialog open onOpenChange={vi.fn()} codex={codex} />);
		expect(
			screen.getByText("Codex sign-in isn't available right now."),
		).toBeTruthy();
		expect(screen.queryByText("ABCD-1234")).toBeNull();
	});

	it("copies the code and opens OpenAI in the same click", async () => {
		render(
			<CodexConnectDialog open onOpenChange={vi.fn()} codex={makeCodex()} />,
		);
		fireEvent.click(screen.getByRole("button", { name: PRIMARY }));
		expect(writeText).toHaveBeenCalledWith("ABCD-1234");
		expect(windowOpen).toHaveBeenCalledWith(
			URI,
			"_blank",
			"noopener,noreferrer",
		);
		await act(async () => {});
		expect(
			screen.getByText("Code copied. Paste it on OpenAI's page."),
		).toBeTruthy();
	});

	it("still opens the tab and offers Copy when the clipboard write fails", async () => {
		writeText.mockRejectedValue(new Error("denied"));
		render(
			<CodexConnectDialog open onOpenChange={vi.fn()} codex={makeCodex()} />,
		);
		fireEvent.click(screen.getByRole("button", { name: PRIMARY }));
		await act(async () => {});
		expect(windowOpen).toHaveBeenCalledTimes(1);
		expect(
			screen.queryByText("Code copied. Paste it on OpenAI's page."),
		).toBeNull();
		expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
	});

	it("never opens a verification URI that differs from the constant", () => {
		const base = makeCodex();
		const codex = makeCodex({
			deviceAuth: {
				...(base.deviceAuth as NonNullable<Codex["deviceAuth"]>),
				verificationUri: "https://evil.example/device" as typeof URI,
			},
		});
		render(<CodexConnectDialog open onOpenChange={vi.fn()} codex={codex} />);
		expect(screen.queryByRole("button", { name: PRIMARY })).toBeNull();
		expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
		expect(windowOpen).not.toHaveBeenCalled();
	});
});
