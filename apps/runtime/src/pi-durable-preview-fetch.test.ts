import { describe, expect, it, vi } from "vitest";
import { candidatePreviewFetch } from "./pi-durable-preview-fetch.ts";

const uuid = "0a1b2c3d-0a1b-4c3d-8a1b-0a1b2c3d4e5f";
const url = `https://10000-c-${uuid}-sometoken.ayn.wtf/x`;

function deps(admit: () => Promise<boolean>, proxied: Response | null) {
	const previewAdmit = vi.fn((_digest: string) => admit());
	const session = vi.fn(() => ({ previewAdmit }));
	const proxy = vi.fn(async () => proxied);
	return { session, proxy, previewAdmit };
}

describe("candidatePreviewFetch", () => {
	it("404s an unparsable host without touching anything", async () => {
		const d = deps(async () => true, new Response("ok"));
		const res = await candidatePreviewFetch(
			new Request("https://example.com/"),
			d,
		);
		expect(res.status).toBe(404);
		expect(d.session).not.toHaveBeenCalled();
		expect(d.proxy).not.toHaveBeenCalled();
	});

	it("404s when admission is refused or throws", async () => {
		const refused = deps(async () => false, new Response("ok"));
		expect(
			(await candidatePreviewFetch(new Request(url), refused)).status,
		).toBe(404);
		expect(refused.proxy).not.toHaveBeenCalled();
		const thrown = deps(async () => {
			throw new Error("boom");
		}, new Response("ok"));
		expect((await candidatePreviewFetch(new Request(url), thrown)).status).toBe(
			404,
		);
		expect(thrown.proxy).not.toHaveBeenCalled();
	});

	it("proxies when admitted, passing a digest and never the token", async () => {
		const d = deps(async () => true, new Response("hello"));
		const res = await candidatePreviewFetch(new Request(url), d);
		expect(await res.text()).toBe("hello");
		const digest = d.previewAdmit.mock.calls[0]?.[0] as unknown as string;
		expect(digest).toMatch(/^[0-9a-f]{64}$/);
		expect(digest).not.toBe("sometoken");
	});

	it("404s when the proxy declines", async () => {
		const d = deps(async () => true, null);
		expect((await candidatePreviewFetch(new Request(url), d)).status).toBe(404);
	});
});
