import { describe, expect, it, vi } from "vitest";
import {
	answerProviderAuthPrompt,
	cancelProviderAuth,
	streamProviderAuthLogin,
} from "#/lib/provider-auth-client";

describe("provider-auth-client", () => {
	it("parses SSE events and posts control answers without leaking values in URL", async () => {
		const chunks = [
			'event: meta\ndata: {"attemptId":"a1","providerId":"openai"}\n\n',
			'event: prompt\ndata: {"promptId":"p1","type":"secret","message":"Key"}\n\n',
			'event: done\ndata: {"ok":true}\n\n',
		];
		const stream = new ReadableStream({
			start(controller) {
				for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
				controller.close();
			},
		});
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			body: stream,
		});
		vi.stubGlobal("fetch", fetchMock);

		const events: unknown[] = [];
		await streamProviderAuthLogin({
			providerId: "openai",
			authType: "api_key",
			onEvent: (e) => events.push(e),
		});
		expect(events[0]).toMatchObject({ event: "meta" });
		expect(
			events.some((e) => (e as { event: string }).event === "prompt"),
		).toBe(true);

		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ accepted: true, action: "answer" }),
		});
		const answered = await answerProviderAuthPrompt({
			attemptId: "a1",
			promptId: "p1",
			value: "sk-secret-value-not-in-url",
		});
		expect(answered.accepted).toBe(true);
		const body = fetchMock.mock.calls.at(-1)?.[1]?.body as string;
		expect(body).toContain("sk-secret-value-not-in-url");
		expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/provider-auth/control");

		fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
		await cancelProviderAuth({ attemptId: "a1" });
		vi.unstubAllGlobals();
	});
});
