import { describe, expect, it, vi } from "vitest";
import {
	boundReadableStream,
	buildPhaseGrant,
	buildUpstreamGitRequest,
	capDiagnostic,
	classifySmartHttpRequest,
	deriveExecutorIdentity,
	isExactSha1,
	makeErrorResult,
	makeSuccessResult,
	reconcileWriteRef,
	runBoundedProcess,
	TRUSTED_GIT_LIMITS,
	TrustedGitPolicyError,
	validateProbeInput,
	validatePushInput,
} from "./trusted-git-executor-policy";

const OWNER = "acme";
const REPO = "widget";
const REF = "refs/heads/main";
const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA2 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DIGEST = "c".repeat(64);

function phase(
	overrides: Partial<Parameters<typeof classifySmartHttpRequest>[1]> = {},
) {
	return {
		owner: OWNER,
		repo: REPO,
		phase: "read" as const,
		expiresAtMs: Date.now() + 60_000,
		containerId: "do-test-1",
		...overrides,
	};
}

function req(
	url: string,
	init: RequestInit & { headers?: Record<string, string> } = {},
): Request {
	return new Request(url, init);
}

describe("identity", () => {
	it("is stable and domain-separated across publication and epoch", async () => {
		const a = await deriveExecutorIdentity("pub-1", 1);
		const b = await deriveExecutorIdentity("pub-1", 1);
		const c = await deriveExecutorIdentity("pub-1", 2);
		const d = await deriveExecutorIdentity("pub-2", 1);
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{64}$/);
		expect(a).not.toBe(c);
		expect(a).not.toBe(d);
		expect(a).not.toContain("pub-1");
	});

	it("rejects empty/oversize publication and non-positive epoch", async () => {
		await expect(deriveExecutorIdentity("", 1)).rejects.toBeInstanceOf(
			TrustedGitPolicyError,
		);
		await expect(
			deriveExecutorIdentity("x".repeat(200), 1),
		).rejects.toBeInstanceOf(TrustedGitPolicyError);
		await expect(deriveExecutorIdentity("pub", 0)).rejects.toBeInstanceOf(
			TrustedGitPolicyError,
		);
		await expect(deriveExecutorIdentity("pub", -1)).rejects.toBeInstanceOf(
			TrustedGitPolicyError,
		);
		await expect(deriveExecutorIdentity("pub", 1.5)).rejects.toBeInstanceOf(
			TrustedGitPolicyError,
		);
	});
});

describe("input validation", () => {
	it("accepts exact probe and push inputs", () => {
		const probe = validateProbeInput({
			publicationId: "pub-1",
			executionEpoch: 3,
			installationId: 99,
			owner: OWNER,
			repo: REPO,
			ref: REF,
		});
		expect(probe.owner).toBe(OWNER);
		const push = validatePushInput({
			...probe,
			r2Key: "plan-047-smoke/bundle.gitbundle",
			bundleSize: 1234,
			bundleSha256: DIGEST,
			proposedSha: SHA,
			expectedOldSha: null,
		});
		expect(push.proposedSha).toBe(SHA);
		expect(push.expectedOldSha).toBeNull();
	});

	it("rejects invalid refs, shas, epochs, and r2 keys", () => {
		const base = {
			publicationId: "pub-1",
			executionEpoch: 1,
			installationId: 1,
			owner: OWNER,
			repo: REPO,
			ref: REF,
		};
		expect(() => validateProbeInput({ ...base, ref: "refs/tags/v1" })).toThrow(
			TrustedGitPolicyError,
		);
		expect(() =>
			validateProbeInput({ ...base, ref: "refs/heads/../x" }),
		).toThrow(TrustedGitPolicyError);
		expect(() =>
			validateProbeInput({ ...base, ref: "refs/heads/.hidden" }),
		).toThrow(TrustedGitPolicyError);
		expect(() =>
			validateProbeInput({ ...base, ref: "refs/heads/foo.lock" }),
		).toThrow(TrustedGitPolicyError);
		expect(() =>
			validateProbeInput({ ...base, ref: "refs/heads/foo." }),
		).toThrow(TrustedGitPolicyError);
		expect(() => validateProbeInput({ ...base, owner: "ACME/evil" })).toThrow(
			TrustedGitPolicyError,
		);
		expect(() =>
			validatePushInput({
				...base,
				r2Key: "../escape",
				bundleSize: 1,
				bundleSha256: DIGEST,
				proposedSha: SHA,
				expectedOldSha: null,
			}),
		).toThrow(TrustedGitPolicyError);
		expect(() =>
			validatePushInput({
				...base,
				r2Key: "ok",
				bundleSize: TRUSTED_GIT_LIMITS.bundleMaxBytes + 1,
				bundleSha256: DIGEST,
				proposedSha: SHA,
				expectedOldSha: null,
			}),
		).toThrow(TrustedGitPolicyError);
		expect(isExactSha1(SHA)).toBe(true);
		expect(isExactSha1(SHA.toUpperCase())).toBe(false);
	});
});

describe("smart-HTTP allow matrix", () => {
	const base = `https://github.com/${OWNER}/${REPO}.git`;

	it("allows exact read discovery and rpc", () => {
		const d = classifySmartHttpRequest(
			req(`${base}/info/refs?service=git-upload-pack`),
			phase({ phase: "read" }),
		);
		expect(d.kind).toBe("read-discovery");
		const r = classifySmartHttpRequest(
			req(`${base}/git-upload-pack`, {
				method: "POST",
				headers: { "content-type": "application/x-git-upload-pack-request" },
			}),
			phase({ phase: "read" }),
		);
		expect(r.kind).toBe("read-rpc");
	});

	it("allows exact write discovery and rpc", () => {
		const d = classifySmartHttpRequest(
			req(`${base}/info/refs?service=git-receive-pack`),
			phase({ phase: "write" }),
		);
		expect(d.kind).toBe("write-discovery");
		const r = classifySmartHttpRequest(
			req(`${base}/git-receive-pack`, {
				method: "POST",
				headers: { "content-type": "application/x-git-receive-pack-request" },
			}),
			phase({ phase: "write" }),
		);
		expect(r.kind).toBe("write-rpc");
	});
});

describe("smart-HTTP adversarial denial", () => {
	const base = `https://github.com/${OWNER}/${REPO}.git`;
	const deny = (
		url: string,
		init?: RequestInit & { headers?: Record<string, string> },
		p = phase(),
	) => {
		expect(() => classifySmartHttpRequest(req(url, init), p)).toThrow(
			TrustedGitPolicyError,
		);
	};
	const denyRaw = (url: string, p = phase()) => {
		expect(() =>
			classifySmartHttpRequest(
				{
					url,
					method: "GET",
					headers: new Headers(),
					body: null,
				} as Request,
				p,
			),
		).toThrow(TrustedGitPolicyError);
	};

	it("denies host lookalikes, trailing dots, uppercase, :443, userinfo, ports, schemes", () => {
		deny(
			`https://github.com.evil/${OWNER}/${REPO}.git/info/refs?service=git-upload-pack`,
		);
		deny(
			`https://evilgithub.com/${OWNER}/${REPO}.git/info/refs?service=git-upload-pack`,
		);
		deny(
			`https://github.com:8443/${OWNER}/${REPO}.git/info/refs?service=git-upload-pack`,
		);
		deny(
			`http://github.com/${OWNER}/${REPO}.git/info/refs?service=git-upload-pack`,
		);
		// Raw authority must be exact lowercase github.com — parser would normalize these.
		denyRaw(
			`https://GITHUB.COM/${OWNER}/${REPO}.git/info/refs?service=git-upload-pack`,
		);
		denyRaw(
			`https://github.com./${OWNER}/${REPO}.git/info/refs?service=git-upload-pack`,
		);
		denyRaw(
			`https://github.com:443/${OWNER}/${REPO}.git/info/refs?service=git-upload-pack`,
		);
		denyRaw(
			`https://x-access-token:tok@github.com/${OWNER}/${REPO}.git/info/refs?service=git-upload-pack`,
		);
		deny(
			`https://github.com/${OWNER}/${REPO}.git/info/refs?service=git-upload-pack`,
			{},
			phase({ expiresAtMs: Date.now() - 1 }),
		);
	});

	it("denies path confusion, other repo, other service, dumb HTTP", () => {
		// Request ctor normalizes `..`; assert policy on pre-normalized raw URL too.
		denyRaw(
			`https://github.com/${OWNER}/${REPO}.git/../${REPO}.git/info/refs?service=git-upload-pack`,
		);
		denyRaw(
			`https://github.com/${OWNER}/${REPO}.git/info/refs?service=git-upload-pack%00`,
		);
		deny(
			`https://github.com/${OWNER}/${REPO}.git/info/refs?service=git-upload-pack`,
			{},
			phase({ repo: "other" }),
		);
		deny(
			`https://github.com/${OWNER}/other.git/info/refs?service=git-upload-pack`,
		);
		deny(`https://github.com/${OWNER}/${REPO}.git/objects/pack/pack-1.pack`);
		deny(`https://github.com/${OWNER}/${REPO}.git/HEAD`);
		deny(
			`https://github.com/${OWNER}/${REPO}.git/info/refs?service=git-receive-pack`,
			{},
			phase({ phase: "read" }),
		);
		deny(
			`https://github.com/${OWNER}/${REPO}.git/git-upload-pack`,
			{
				method: "POST",
				headers: { "content-type": "application/x-git-upload-pack-request" },
			},
			phase({ phase: "write" }),
		);
	});

	it("denies query/method/content-type/auth/cookie issues", () => {
		deny(`${base}/info/refs?service=git-upload-pack&extra=1`);
		deny(`${base}/info/refs?service=git-upload-pack`, { method: "HEAD" });
		deny(`${base}/info/refs?service=git-upload-pack`, { method: "PUT" });
		deny(`${base}/git-upload-pack`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
		});
		deny(`${base}/git-upload-pack`, { method: "POST" });
		deny(`${base}/git-upload-pack?foo=1`, {
			method: "POST",
			headers: { "content-type": "application/x-git-upload-pack-request" },
		});
		deny(`${base}/info/refs?service=git-upload-pack`, {
			headers: { authorization: "Bearer x" },
		});
		deny(`${base}/info/refs?service=git-upload-pack`, {
			headers: { cookie: "a=b" },
		});
		// Header allowlist value checks
		deny(`${base}/info/refs?service=git-upload-pack`, {
			headers: { accept: "text/html" },
		});
		deny(`${base}/info/refs?service=git-upload-pack`, {
			headers: { "git-protocol": "version=1" },
		});
		deny(`${base}/info/refs?service=git-upload-pack`, {
			headers: { "user-agent": "curl/8.0" },
		});
	});

	it("denies Accept parameters and oversize Accept/git-protocol", () => {
		// Parameters must not be stripped and forwarded.
		deny(`${base}/info/refs?service=git-upload-pack`, {
			headers: { accept: "*/*;secret=x" },
		});
		deny(`${base}/info/refs?service=git-upload-pack`, {
			headers: { accept: "*/*;q=0.9" },
		});
		deny(`${base}/info/refs?service=git-upload-pack`, {
			headers: {
				accept: `*/*${"a".repeat(TRUSTED_GIT_LIMITS.acceptMaxBytes)}`,
			},
		});
		deny(`${base}/info/refs?service=git-upload-pack`, {
			headers: {
				"git-protocol": `version=2${"x".repeat(TRUSTED_GIT_LIMITS.gitProtocolMaxBytes)}`,
			},
		});
		// Exact approved values still allowed.
		expect(
			classifySmartHttpRequest(
				req(`${base}/info/refs?service=git-upload-pack`, {
					headers: { accept: "*/*" },
				}),
				phase(),
			).kind,
		).toBe("read-discovery");
	});

	it("denies container/class grant mismatch when ctx provided", () => {
		expect(() =>
			classifySmartHttpRequest(
				req(`${base}/info/refs?service=git-upload-pack`),
				phase(),
				Date.now(),
				{ containerId: "other", className: "TrustedGitExecutor" },
			),
		).toThrow(TrustedGitPolicyError);
		expect(() =>
			classifySmartHttpRequest(
				req(`${base}/info/refs?service=git-upload-pack`),
				phase(),
				Date.now(),
				{ containerId: "do-test-1", className: "Sandbox" },
			),
		).toThrow(TrustedGitPolicyError);
		// Matching ctx allows
		expect(
			classifySmartHttpRequest(
				req(`${base}/info/refs?service=git-upload-pack`),
				phase(),
				Date.now(),
				{ containerId: "do-test-1", className: "TrustedGitExecutor" },
			).kind,
		).toBe("read-discovery");
	});
});

describe("upstream request builder and token headers", () => {
	it("injects basic auth and strips disallowed headers", () => {
		expect(() =>
			classifySmartHttpRequest(
				req(`https://github.com/${OWNER}/${REPO}.git/git-upload-pack`, {
					method: "POST",
					headers: {
						"content-type": "application/x-git-upload-pack-request",
						authorization: "Bearer nope",
					},
				}),
				phase({ phase: "read" }),
			),
		).toThrow(TrustedGitPolicyError);

		const clean = req(
			`https://github.com/${OWNER}/${REPO}.git/git-upload-pack`,
			{
				method: "POST",
				headers: {
					"content-type": "application/x-git-upload-pack-request",
					accept: "application/x-git-upload-pack-result",
					"user-agent": "git/2.49.1",
				},
			},
		);
		const classified = classifySmartHttpRequest(
			clean,
			phase({ phase: "read" }),
		);
		const token = `ghs_${"t".repeat(40)}`;
		const upstream = buildUpstreamGitRequest(
			req(`https://github.com/${OWNER}/${REPO}.git/git-upload-pack`, {
				method: "POST",
				headers: {
					"content-type": "application/x-git-upload-pack-request",
					"x-forwarded-for": "1.2.3.4",
					cookie: "evil=1",
					accept: "application/x-git-upload-pack-result",
					"user-agent": "git/2.49.1",
				},
			}),
			classified,
			token,
		);
		expect(upstream.headers.get("authorization")).toMatch(/^Basic /);
		expect(upstream.headers.get("cookie")).toBeNull();
		expect(upstream.headers.get("x-forwarded-for")).toBeNull();
		expect(upstream.headers.get("content-type")).toBe(
			"application/x-git-upload-pack-request",
		);
		expect(upstream.redirect).toBe("manual");
		// Basic must decode to x-access-token:token
		const auth = upstream.headers.get("authorization");
		expect(auth).toBeTruthy();
		const basic = (auth ?? "").slice("Basic ".length);
		expect(atob(basic)).toBe(`x-access-token:${token}`);
	});
});

describe("stream bounds and finalizer", () => {
	it("finalizes exactly once on EOF", async () => {
		let calls = 0;
		const src = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(new Uint8Array([1, 2, 3]));
				c.close();
			},
		});
		const bounded = boundReadableStream(src, 100, async () => {
			calls += 1;
		});
		const reader = bounded.getReader();
		while (!(await reader.read()).done) {
			/* drain */
		}
		expect(calls).toBe(1);
	});

	it("finalizes on cancel and oversize", async () => {
		let calls = 0;
		const src = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(new Uint8Array(50));
				c.enqueue(new Uint8Array(50));
			},
		});
		const bounded = boundReadableStream(src, 60, async () => {
			calls += 1;
		});
		const reader = bounded.getReader();
		await reader.read();
		await expect(reader.read()).rejects.toBeInstanceOf(TrustedGitPolicyError);
		expect(calls).toBe(1);

		let cancelCalls = 0;
		const src2 = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(new Uint8Array([1]));
			},
		});
		const bounded2 = boundReadableStream(src2, 100, async () => {
			cancelCalls += 1;
		});
		const r2 = bounded2.getReader();
		await r2.read();
		await r2.cancel();
		expect(cancelCalls).toBe(1);
	});
});

describe("results, redaction, reconciliation", () => {
	it("caps diagnostics and redacts secret shapes", () => {
		const token = `ghs_${"s".repeat(40)}`;
		const diag = capDiagnostic(`error ${token} ${"x".repeat(20_000)}`, [token]);
		expect(diag).not.toContain(token);
		expect(diag).toContain("[REDACTED]");
		expect(new TextEncoder().encode(diag).byteLength).toBeLessThanOrEqual(
			TRUSTED_GIT_LIMITS.diagnosticMaxBytes,
		);
	});

	it("builds success/error unions with cleanup flags", () => {
		const ok = makeSuccessResult({
			publicationIdHash: "a".repeat(64),
			executionEpoch: 1,
			ref: REF,
			sha: SHA,
			revoked: true,
			destroyed: true,
		});
		expect(ok.ok).toBe(true);
		const err = makeErrorResult({
			code: "cleanup_failed",
			revoked: true,
			destroyed: false,
		});
		expect(err.ok).toBe(false);
		if (!err.ok) expect(err.code).toBe("cleanup_failed");
	});

	it("reconciles write three-state matrix", () => {
		expect(
			reconcileWriteRef({
				observedSha: SHA2,
				proposedSha: SHA2,
				expectedOldSha: SHA,
			}),
		).toEqual({ action: "success", sha: SHA2 });
		expect(
			reconcileWriteRef({
				observedSha: SHA,
				proposedSha: SHA2,
				expectedOldSha: SHA,
			}),
		).toEqual({ action: "retry" });
		expect(
			reconcileWriteRef({
				observedSha: null,
				proposedSha: SHA2,
				expectedOldSha: null,
			}),
		).toEqual({ action: "retry" });
		expect(
			reconcileWriteRef({
				observedSha: "c".repeat(40),
				proposedSha: SHA2,
				expectedOldSha: SHA,
			}).action,
		).toBe("interrupted");
	});

	it("phase grant is non-secret and bounded", () => {
		const g = buildPhaseGrant({
			publicationIdHash: "a".repeat(64),
			executionEpoch: 1,
			installationId: 9,
			owner: OWNER,
			repo: REPO,
			phase: "read",
			containerId: "do-test-1",
			nowMs: 1_000,
			ttlMs: 999_999,
		});
		expect(g.expiresAtMs - 1_000).toBe(TRUSTED_GIT_LIMITS.phaseGrantMaxMs);
		expect(g.containerId).toBe("do-test-1");
		expect(JSON.stringify(g)).not.toMatch(/gh[pousr]_/i);
	});

	it("finalizer runs before close so revoke failure is not success", async () => {
		const order: string[] = [];
		const src = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(new Uint8Array([1]));
				c.close();
			},
		});
		const bounded = boundReadableStream(src, 100, async () => {
			order.push("finalize");
			throw new Error("revoke failed");
		});
		const reader = bounded.getReader();
		await reader.read(); // data
		await expect(reader.read()).rejects.toBeTruthy();
		expect(order).toEqual(["finalize"]);
	});
});

describe("runBoundedProcess hard bounds", () => {
	function neverStream(): ReadableStream<Uint8Array> {
		return new ReadableStream<Uint8Array>({
			pull() {
				// never enqueues and never closes
			},
			cancel() {
				// ignore — even cancel may hang at source; drain must not await it
				return new Promise(() => {});
			},
		});
	}

	it("returns within grace when stdout never closes", async () => {
		const kill = vi.fn();
		const started = Date.now();
		const result = await runBoundedProcess(
			{
				stdout: neverStream(),
				stderr: new ReadableStream({
					start(c) {
						c.close();
					},
				}),
				exitCode: Promise.resolve(0),
				kill,
			},
			{
				timeoutMs: 40,
				maxStdoutBytes: 1024,
				maxStderrBytes: 1024,
				killGraceMs: 30,
			},
		);
		const elapsed = Date.now() - started;
		expect(elapsed).toBeLessThan(500);
		expect(result.timedOut).toBe(true);
		expect(kill).toHaveBeenCalled();
	});

	it("returns within grace when stderr never closes", async () => {
		const kill = vi.fn();
		const started = Date.now();
		const result = await runBoundedProcess(
			{
				stdout: new ReadableStream({
					start(c) {
						c.close();
					},
				}),
				stderr: neverStream(),
				exitCode: Promise.resolve(0),
				kill,
			},
			{
				timeoutMs: 40,
				maxStdoutBytes: 1024,
				maxStderrBytes: 1024,
				killGraceMs: 30,
			},
		);
		expect(Date.now() - started).toBeLessThan(500);
		expect(result.timedOut).toBe(true);
		expect(kill).toHaveBeenCalled();
	});

	it("returns within grace when exitCode never settles", async () => {
		const kill = vi.fn();
		const started = Date.now();
		const result = await runBoundedProcess(
			{
				stdout: new ReadableStream({
					start(c) {
						c.close();
					},
				}),
				stderr: new ReadableStream({
					start(c) {
						c.close();
					},
				}),
				exitCode: new Promise(() => {}),
				kill,
			},
			{
				timeoutMs: 40,
				maxStdoutBytes: 1024,
				maxStderrBytes: 1024,
				killGraceMs: 30,
			},
		);
		expect(Date.now() - started).toBeLessThan(500);
		expect(result.timedOut).toBe(true);
		expect(result.killed).toBe(true);
		expect(kill).toHaveBeenCalled();
	});

	it("kills immediately on overflow even if exit never settles", async () => {
		const kill = vi.fn();
		const started = Date.now();
		const flood = new ReadableStream<Uint8Array>({
			start(c) {
				const chunk = new Uint8Array(2048);
				chunk.fill(65);
				for (let i = 0; i < 10; i++) c.enqueue(chunk);
				// never close
			},
		});
		const result = await runBoundedProcess(
			{
				stdout: flood,
				stderr: new ReadableStream({
					start(c) {
						c.close();
					},
				}),
				exitCode: new Promise(() => {}),
				kill,
			},
			{
				timeoutMs: 5_000,
				maxStdoutBytes: 1024,
				maxStderrBytes: 1024,
				killGraceMs: 40,
			},
		);
		expect(Date.now() - started).toBeLessThan(1000);
		expect(result.overflow).toBe(true);
		expect(kill).toHaveBeenCalled();
		expect(result.killed).toBe(true);
	});
});
