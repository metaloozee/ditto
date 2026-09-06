import { describe, expect, it, vi } from "vitest";
import { encodeFlushPkt, encodePktLine } from "./git-pkt-line";
import {
	buildAuthenticatedGitPushUpstreamRequest,
	GIT_PUSH_CONTRACT_VERSION,
	GIT_PUSH_ENABLED,
	readGitPushDiscoveryResponse,
	validateGitPushRequest,
	wrapGitPushReceivePackResponse,
} from "./git-push-contract";
import { ZERO_OID } from "./git-receive-pack";

const NEW_OID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REF = "refs/heads/ditto/session-1";
const CAPS =
	"report-status-v2 side-band-64k quiet object-format=sha1 agent=git/2.52.0-Linux";

const BOUND = {
	repository: "acme/app",
	allowedRefs: [REF],
	preflightHeadSha: NEW_OID,
	advertisedOldOid: ZERO_OID,
	contractVersion: GIT_PUSH_CONTRACT_VERSION,
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

function receivePackBody(options?: {
	oldOid?: string;
	newOid?: string;
	ref?: string;
}): Uint8Array {
	return concatBytes(
		encodePktLine(
			`${options?.oldOid ?? ZERO_OID} ${options?.newOid ?? NEW_OID} ${options?.ref ?? REF}\0 ${CAPS}\n`,
		),
		encodeFlushPkt(),
		new Uint8Array([0x50, 0x41, 0x43, 0x4b]),
	);
}

function infoRefsRequest(path = "/acme/app.git/info/refs"): Request {
	return new Request(`https://github.com${path}?service=git-receive-pack`, {
		method: "GET",
	});
}

function receivePackRequest(
	body: Uint8Array,
	options?: { headers?: HeadersInit; path?: string },
): Request {
	return new Request(
		`https://github.com${options?.path ?? "/acme/app.git/git-receive-pack"}`,
		{
			method: "POST",
			headers: {
				"content-type": "application/x-git-receive-pack-request",
				...Object.fromEntries(new Headers(options?.headers ?? [])),
			},
			body: body.buffer.slice(
				body.byteOffset,
				body.byteOffset + body.byteLength,
			) as ArrayBuffer,
		},
	);
}

describe("git-push-contract", () => {
	it("exposes the disabled product gate", () => {
		expect(GIT_PUSH_ENABLED).toBe(false);
	});

	it("passes stock git/2.34.1 info/refs headers", async () => {
		const result = await validateGitPushRequest(
			new Request(
				"https://github.com/acme/app.git/info/refs?service=git-receive-pack",
				{
					method: "GET",
					headers: {
						Host: "github.com",
						"User-Agent": "git/2.34.1",
						Accept: "*/*",
						"Accept-Encoding": "deflate, gzip, br, zstd",
						Pragma: "no-cache",
						"Git-Protocol": "version=1",
					},
				},
			),
			{ ...BOUND, advertisedOldOid: null },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.headers.has("host")).toBe(false);
			expect(result.headers.get("pragma")).toBe("no-cache");
			expect(result.headers.has("accept-encoding")).toBe(false);
		}
	});

	it("passes GET info/refs?service=git-receive-pack", async () => {
		const result = await validateGitPushRequest(infoRefsRequest(), {
			...BOUND,
			advertisedOldOid: null,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.phase).toBe("discovery");
			expect(result.method).toBe("GET");
			expect(result.upstreamUrl.searchParams.get("service")).toBe(
				"git-receive-pack",
			);
		}
	});

	it("passes POST receive-pack with a valid create", async () => {
		const result = await validateGitPushRequest(
			receivePackRequest(receivePackBody()),
			BOUND,
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.phase).toBe("receive-pack");
			expect(result.body).not.toBeNull();
		}
	});

	it("fails Authorization from caller", async () => {
		const result = await validateGitPushRequest(
			new Request(
				"https://github.com/acme/app.git/info/refs?service=git-receive-pack",
				{ headers: { Authorization: "Bearer stolen" } },
			),
			{ ...BOUND, advertisedOldOid: null },
		);
		expect(result).toMatchObject({ ok: false, code: "forbidden_header" });
	});

	it("fails Cookie from caller", async () => {
		const result = await validateGitPushRequest(
			new Request(
				"https://github.com/acme/app.git/info/refs?service=git-receive-pack",
				{ headers: { Cookie: "session=1" } },
			),
			{ ...BOUND, advertisedOldOid: null },
		);
		expect(result).toMatchObject({ ok: false, code: "forbidden_header" });
	});

	it("fails x-forwarded and proxy headers", async () => {
		const result = await validateGitPushRequest(
			new Request(
				"https://github.com/acme/app.git/info/refs?service=git-receive-pack",
				{ headers: { "x-forwarded-for": "1.1.1.1" } },
			),
			{ ...BOUND, advertisedOldOid: null },
		);
		expect(result).toMatchObject({ ok: false, code: "forbidden_header" });
	});

	it("rejects upload-pack on a push bound", async () => {
		const result = await validateGitPushRequest(
			new Request(
				"https://github.com/acme/app.git/info/refs?service=git-upload-pack",
			),
			{ ...BOUND, advertisedOldOid: null },
		);
		expect(result.ok).toBe(false);
	});

	it("does not mint a token on deny", async () => {
		const mint = vi.fn(async () => "token");
		const denied = await validateGitPushRequest(
			infoRefsRequest("/other/repo.git/info/refs"),
			{ ...BOUND, advertisedOldOid: null },
		);
		expect(denied.ok).toBe(false);
		expect(mint).not.toHaveBeenCalled();
	});

	it("mints a token only after validation passes", async () => {
		const mint = vi.fn(async () => "ghs_token");
		const validated = await validateGitPushRequest(infoRefsRequest(), {
			...BOUND,
			advertisedOldOid: null,
		});
		expect(validated.ok).toBe(true);
		if (!validated.ok) return;
		const upstream = await buildAuthenticatedGitPushUpstreamRequest({
			validated,
			mintToken: mint,
		});
		expect(mint).toHaveBeenCalledOnce();
		expect(upstream.headers.get("Authorization")).toBe("token ghs_token");
		expect(upstream.redirect).toBe("manual");
		expect(upstream.url).not.toContain("ghs_token");
	});

	it("rejects a redirect discovery response", async () => {
		await expect(
			readGitPushDiscoveryResponse(
				new Response(null, {
					status: 302,
					headers: { Location: "https://evil.example/" },
				}),
				REF,
			),
		).rejects.toMatchObject({ code: "redirect_denied" });
	});

	it("rejects a redirect receive-pack response", async () => {
		await expect(
			wrapGitPushReceivePackResponse(new Response(null, { status: 301 }), REF),
		).rejects.toMatchObject({ code: "redirect_denied" });
	});

	it("strips credential-shaped response headers", async () => {
		const inner = concatBytes(
			encodePktLine("unpack ok\n"),
			encodePktLine(`ok ${REF}\n`),
			encodeFlushPkt(),
		);
		const wrapped = await wrapGitPushReceivePackResponse(
			new Response(
				inner.buffer.slice(
					inner.byteOffset,
					inner.byteOffset + inner.byteLength,
				) as ArrayBuffer,
				{
					status: 200,
					headers: {
						"content-type": "application/x-git-receive-pack-result",
						"set-cookie": "evil=1",
						authorization: "token leaked",
					},
				},
			),
			REF,
		);
		expect(wrapped.headers.get("content-type")).toBe(
			"application/x-git-receive-pack-result",
		);
		expect(wrapped.headers.get("set-cookie")).toBeNull();
		expect(wrapped.headers.get("authorization")).toBeNull();
	});
});
