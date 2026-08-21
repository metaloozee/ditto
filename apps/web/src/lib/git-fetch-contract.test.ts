import { describe, expect, it, vi } from "vitest";
import {
	buildAuthenticatedGitUpstreamRequest,
	GIT_FETCH_CONTRACT_VERSION,
	validateGitFetchRequest,
} from "./git-fetch-contract";
import { encodeFlushPkt, encodePktLine } from "./git-pkt-line";

const BOUND = {
	repository: "acme/app",
	allowedRefs: ["refs/heads/main"],
	contractVersion: GIT_FETCH_CONTRACT_VERSION,
};

function concatBytes(...parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

function infoRefsRequest(path = "/acme/app.git/info/refs"): Request {
	return new Request(`https://github.com${path}?service=git-upload-pack`, {
		method: "GET",
	});
}

function uploadPackRequest(
	body: Uint8Array,
	options?: { headers?: HeadersInit; path?: string },
): Request {
	return new Request(
		`https://github.com${options?.path ?? "/acme/app.git/git-upload-pack"}`,
		{
			method: "POST",
			headers: {
				"content-type": "application/x-git-upload-pack-request",
				"git-protocol": "version=2",
				...Object.fromEntries(new Headers(options?.headers ?? [])),
			},
			body: body.buffer.slice(
				body.byteOffset,
				body.byteOffset + body.byteLength,
			) as ArrayBuffer,
		},
	);
}

function minimalV2FetchBody(
	oid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
): Uint8Array {
	return concatBytes(
		encodePktLine("command=fetch\n"),
		encodePktLine("object-format=sha1\n"),
		new Uint8Array([0x30, 0x30, 0x30, 0x31]), // delim
		encodePktLine(`want ${oid}\n`),
		encodePktLine("done\n"),
		encodeFlushPkt(),
	);
}

describe("git-fetch-contract", () => {
	it("passes GET info/refs?service=git-upload-pack", async () => {
		const result = await validateGitFetchRequest(infoRefsRequest(), BOUND);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.method).toBe("GET");
			expect(result.upstreamUrl.pathname).toBe("/acme/app.git/info/refs");
			expect(result.upstreamUrl.searchParams.get("service")).toBe(
				"git-upload-pack",
			);
		}
	});

	it("passes POST upload-pack with minimal v2 fetch", async () => {
		const result = await validateGitFetchRequest(
			uploadPackRequest(minimalV2FetchBody()),
			BOUND,
		);
		expect(result.ok).toBe(true);
	});

	it("fails wrong repository", async () => {
		const result = await validateGitFetchRequest(
			infoRefsRequest("/other/repo.git/info/refs"),
			BOUND,
		);
		expect(result).toMatchObject({ ok: false, code: "repository_mismatch" });
	});

	it("fails wrong method on info/refs", async () => {
		const result = await validateGitFetchRequest(
			new Request(
				"https://github.com/acme/app.git/info/refs?service=git-upload-pack",
				{ method: "POST" },
			),
			BOUND,
		);
		expect(result).toMatchObject({ ok: false, code: "invalid_method" });
	});

	it("fails extra query keys", async () => {
		const result = await validateGitFetchRequest(
			new Request(
				"https://github.com/acme/app.git/info/refs?service=git-upload-pack&foo=1",
			),
			BOUND,
		);
		expect(result).toMatchObject({ ok: false, code: "invalid_query" });
	});

	it("fails Authorization from caller", async () => {
		const result = await validateGitFetchRequest(
			new Request(
				"https://github.com/acme/app.git/info/refs?service=git-upload-pack",
				{ headers: { Authorization: "Bearer stolen" } },
			),
			BOUND,
		);
		expect(result).toMatchObject({ ok: false, code: "forbidden_header" });
	});

	it("fails Cookie from caller", async () => {
		const result = await validateGitFetchRequest(
			new Request(
				"https://github.com/acme/app.git/info/refs?service=git-upload-pack",
				{ headers: { Cookie: "session=1" } },
			),
			BOUND,
		);
		expect(result).toMatchObject({ ok: false, code: "forbidden_header" });
	});

	it("fails wrong content type", async () => {
		const body = minimalV2FetchBody();
		const result = await validateGitFetchRequest(
			new Request("https://github.com/acme/app.git/git-upload-pack", {
				method: "POST",
				headers: { "content-type": "text/plain" },
				body: body.buffer.slice(
					body.byteOffset,
					body.byteOffset + body.byteLength,
				) as ArrayBuffer,
			}),
			BOUND,
		);
		expect(result).toMatchObject({ ok: false, code: "invalid_content_type" });
	});

	it("fails unknown v2 command", async () => {
		const body = concatBytes(encodePktLine("command=push\n"), encodeFlushPkt());
		const result = await validateGitFetchRequest(
			uploadPackRequest(body),
			BOUND,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("unknown_command");
		}
	});

	it("fails want-ref outside allowedRefs", async () => {
		const body = concatBytes(
			encodePktLine("command=fetch\n"),
			new Uint8Array([0x30, 0x30, 0x30, 0x31]),
			encodePktLine("want-ref refs/heads/secret\n"),
			encodePktLine("done\n"),
			encodeFlushPkt(),
		);
		const result = await validateGitFetchRequest(
			uploadPackRequest(body),
			BOUND,
		);
		expect(result).toMatchObject({ ok: false, code: "ref_denied" });
	});

	it("fails ls-refs with wide ref-prefix refs/heads/", async () => {
		const body = concatBytes(
			encodePktLine("command=ls-refs\n"),
			new Uint8Array([0x30, 0x30, 0x30, 0x31]),
			encodePktLine("ref-prefix refs/heads/\n"),
			encodeFlushPkt(),
		);
		const result = await validateGitFetchRequest(
			uploadPackRequest(body),
			BOUND,
		);
		expect(result).toMatchObject({ ok: false, code: "ref_denied" });
	});

	it("fails ls-refs missing a narrow ref-prefix", async () => {
		const body = concatBytes(
			encodePktLine("command=ls-refs\n"),
			new Uint8Array([0x30, 0x30, 0x30, 0x31]),
			encodePktLine("peel\n"),
			encodePktLine("symrefs\n"),
			encodeFlushPkt(),
		);
		const result = await validateGitFetchRequest(
			uploadPackRequest(body),
			BOUND,
		);
		expect(result).toMatchObject({ ok: false, code: "ref_denied" });
	});

	it("passes ls-refs with exact allowed ref-prefix", async () => {
		const body = concatBytes(
			encodePktLine("command=ls-refs\n"),
			new Uint8Array([0x30, 0x30, 0x30, 0x31]),
			encodePktLine("ref-prefix refs/heads/main\n"),
			encodeFlushPkt(),
		);
		const result = await validateGitFetchRequest(
			uploadPackRequest(body),
			BOUND,
		);
		expect(result.ok).toBe(true);
	});

	it("fails filter capability", async () => {
		const body = concatBytes(
			encodePktLine("command=fetch\n"),
			encodePktLine("filter\n"),
			new Uint8Array([0x30, 0x30, 0x30, 0x31]),
			encodePktLine("want aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"),
			encodePktLine("done\n"),
			encodeFlushPkt(),
		);
		const result = await validateGitFetchRequest(
			uploadPackRequest(body),
			BOUND,
		);
		expect(result).toMatchObject({ ok: false, code: "capability_denied" });
	});

	it("fails oversized body", async () => {
		const huge = new Uint8Array(2 * 1024 * 1024);
		huge.set(encodePktLine("command=fetch\n"), 0);
		const result = await validateGitFetchRequest(
			uploadPackRequest(huge),
			BOUND,
		);
		expect(result.ok).toBe(false);
	});

	it("does not mint token on deny", async () => {
		const mint = vi.fn(async () => "token");
		const denied = await validateGitFetchRequest(
			infoRefsRequest("/other/repo.git/info/refs"),
			BOUND,
		);
		expect(denied.ok).toBe(false);
		expect(mint).not.toHaveBeenCalled();
	});

	it("mints token only after validation passes", async () => {
		const mint = vi.fn(async () => "ghs_token");
		const validated = await validateGitFetchRequest(infoRefsRequest(), BOUND);
		expect(validated.ok).toBe(true);
		if (!validated.ok) return;
		const upstream = await buildAuthenticatedGitUpstreamRequest({
			validated,
			mintToken: mint,
		});
		expect(mint).toHaveBeenCalledOnce();
		expect(upstream.headers.get("Authorization")).toBe("token ghs_token");
		expect(upstream.url).not.toContain("ghs_token");
		expect(upstream.url).toContain("https://github.com/acme/app.git/info/refs");
	});

	it("passes minimal v1 want/done of allowed tip", async () => {
		const body = concatBytes(
			encodePktLine(
				"want aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa multi_ack_detailed side-band-64k ofs-delta agent=git/2.0\n",
			),
			encodeFlushPkt(),
			encodePktLine("done\n"),
		);
		const result = await validateGitFetchRequest(
			new Request("https://github.com/acme/app.git/git-upload-pack", {
				method: "POST",
				headers: {
					"content-type": "application/x-git-upload-pack-request",
				},
				body: body.buffer.slice(
					body.byteOffset,
					body.byteOffset + body.byteLength,
				) as ArrayBuffer,
			}),
			BOUND,
		);
		expect(result.ok).toBe(true);
	});
});
