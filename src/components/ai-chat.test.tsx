/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearAllSessionMessages,
	listPendingSessionMessages,
	readSessionMessages,
	seedSessionMessages,
} from "#/lib/chat-session-cache";

vi.mock("#/components/composer", () => ({
	Composer: () => <div data-testid="composer-stub" />,
}));

vi.mock("#/components/assistant-markdown", () => ({
	AssistantMarkdown: ({ text }: { text: string }) => <div>{text}</div>,
}));

vi.mock("#/components/edit-tool-diff", () => ({
	EditToolPart: () => null,
}));

vi.mock("#/components/ui/message-scroller", () => ({
	MessageScrollerProvider: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	MessageScroller: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	MessageScrollerViewport: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	MessageScrollerContent: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	MessageScrollerItem: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	MessageScrollerButton: () => null,
	useMessageScrollerScrollable: () => ({ start: true, end: true }),
}));

const { Chat } = await import("./ai-chat");

describe("Chat session cache acknowledgement", () => {
	beforeEach(() => {
		clearAllSessionMessages();
	});

	afterEach(() => {
		cleanup();
		clearAllSessionMessages();
	});

	it("shows pending cached content until server messages arrive", () => {
		seedSessionMessages("sess-1", [
			{ id: "pending-1", role: "user", content: "optimistic hello" },
		]);

		render(
			<Chat
				projectId="proj-1"
				sessionId="sess-1"
				messages={[{ id: "old-1", role: "user", content: "older" }]}
			/>,
		);

		expect(screen.getByText("optimistic hello")).toBeTruthy();
		expect(screen.getByText("older")).toBeTruthy();
		expect(
			listPendingSessionMessages("sess-1", [{ id: "old-1" }]),
		).toHaveLength(1);
	});

	it("acknowledges cache entries when server messages include those ids", async () => {
		seedSessionMessages("sess-1", [
			{ id: "msg-1", role: "user", content: "from cache" },
			{ id: "msg-2", role: "assistant", content: "assistant cache" },
		]);

		render(
			<Chat
				projectId="proj-1"
				sessionId="sess-1"
				messages={[
					{ id: "msg-1", role: "user", content: "from server" },
					{ id: "msg-2", role: "assistant", content: "assistant server" },
				]}
			/>,
		);

		expect(screen.getByText("from server")).toBeTruthy();
		expect(screen.getByText("assistant server")).toBeTruthy();

		await waitFor(() => {
			expect(readSessionMessages("sess-1")).toEqual([]);
		});
		expect(
			listPendingSessionMessages("sess-1", [{ id: "msg-1" }, { id: "msg-2" }]),
		).toEqual([]);
	});

	it("does not clear a different session's cache when acknowledging", async () => {
		seedSessionMessages("sess-1", [
			{ id: "msg-1", role: "user", content: "sess1" },
		]);
		seedSessionMessages("sess-2", [
			{ id: "msg-9", role: "user", content: "sess2 keep" },
		]);

		render(
			<Chat
				projectId="proj-1"
				sessionId="sess-1"
				messages={[{ id: "msg-1", role: "user", content: "sess1 server" }]}
			/>,
		);

		await waitFor(() => {
			expect(readSessionMessages("sess-1")).toEqual([]);
		});
		expect(readSessionMessages("sess-2")).toHaveLength(1);
	});

	it("keeps pending overlays after memoized projections re-render", () => {
		const stableMessages = [
			{ id: "old-1", role: "user" as const, content: "older" },
		];
		seedSessionMessages("sess-memo", [
			{ id: "pending-1", role: "user", content: "optimistic hello" },
		]);

		const { rerender } = render(
			<Chat
				projectId="proj-1"
				sessionId="sess-memo"
				messages={stableMessages}
			/>,
		);

		expect(screen.getByText("optimistic hello")).toBeTruthy();
		expect(screen.getByText("older")).toBeTruthy();

		// Same messages array identity should not drop the pending overlay.
		rerender(
			<Chat
				projectId="proj-1"
				sessionId="sess-memo"
				messages={stableMessages}
			/>,
		);

		expect(screen.getByText("optimistic hello")).toBeTruthy();
		expect(screen.getByText("older")).toBeTruthy();
		expect(
			listPendingSessionMessages("sess-memo", [{ id: "old-1" }]),
		).toHaveLength(1);
	});

	it("shows load-earlier control when hasMoreHistory and calls onLoadEarlier", () => {
		const onLoadEarlier = vi.fn();

		render(
			<Chat
				projectId="proj-1"
				sessionId="sess-1"
				messages={[{ id: "msg-1", role: "user", content: "newest page" }]}
				hasMoreHistory
				onLoadEarlier={onLoadEarlier}
			/>,
		);

		const button = screen.getByRole("button", {
			name: /load earlier messages/i,
		});
		expect(button).toBeTruthy();
		// No page-number UI
		expect(screen.queryByText(/page\s+\d+/i)).toBeNull();

		button.click();
		expect(onLoadEarlier).toHaveBeenCalledTimes(1);
	});

	it("shows loading state on load-earlier control", () => {
		render(
			<Chat
				projectId="proj-1"
				sessionId="sess-1"
				messages={[{ id: "msg-1", role: "user", content: "newest page" }]}
				hasMoreHistory
				isLoadingMoreHistory
				onLoadEarlier={() => {}}
			/>,
		);

		expect(screen.getByText(/loading earlier messages/i)).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: /^load earlier messages$/i }),
		).toBeNull();
	});

	it("hides load-earlier control when no more history", () => {
		render(
			<Chat
				projectId="proj-1"
				sessionId="sess-1"
				messages={[{ id: "msg-1", role: "user", content: "all loaded" }]}
				hasMoreHistory={false}
			/>,
		);

		expect(
			screen.queryByRole("button", { name: /load earlier messages/i }),
		).toBeNull();
	});

	it("acknowledges against flattened multi-page server ids", async () => {
		seedSessionMessages("sess-pages", [
			{ id: "old-1", role: "user", content: "from older page" },
			{ id: "new-1", role: "user", content: "from newest page" },
		]);

		// Flattened infinite pages: older + newer server messages.
		render(
			<Chat
				projectId="proj-1"
				sessionId="sess-pages"
				messages={[
					{ id: "old-1", role: "user", content: "older server" },
					{ id: "new-1", role: "user", content: "newer server" },
				]}
				hasMoreHistory
			/>,
		);

		expect(screen.getByText("older server")).toBeTruthy();
		expect(screen.getByText("newer server")).toBeTruthy();
		await waitFor(() => {
			expect(readSessionMessages("sess-pages")).toEqual([]);
		});
	});
});
