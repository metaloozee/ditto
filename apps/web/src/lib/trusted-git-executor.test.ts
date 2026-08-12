import { beforeEach, describe, expect, it, vi } from "vitest";

const getInstallationAccessToken = vi.hoisted(() => vi.fn());
const revokeInstallationAccessToken = vi.hoisted(() => vi.fn());

vi.mock("#/lib/github-app", () => ({
	getInstallationAccessToken,
	revokeInstallationAccessToken,
	getGitHubApp: vi.fn(),
	repositoryNameFromSlug: (s: string) => s.split("/").pop(),
}));

vi.mock("@cloudflare/containers", () => {
	class Container {
		env: unknown;
		ctx: unknown;
		sleepAfter = "2m";
		enableInternet = false;
		interceptHttps = true;
		envVars: Record<string, string> = {};
		entrypoint: string[] = [];
		static outbound: unknown;
		static outboundHandlers: Record<string, unknown> = {};
		constructor(ctx: unknown, env: unknown) {
			this.ctx = ctx;
			this.env = env;
		}
		start = vi.fn(async () => undefined);
		setOutboundByHost = vi.fn(async () => undefined);
		removeOutboundByHost = vi.fn(async () => undefined);
		setOutboundHandler = vi.fn(async () => undefined);
	}
	return {
		Container,
		ContainerProxy: class ContainerProxy {},
	};
});

const { TrustedGitExecutor } = await import("./trusted-git-executor");
const { deriveExecutorIdentity } = await import(
	"./trusted-git-executor-policy"
);

const SHA_OLD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_NEW = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DIGEST = "c".repeat(64);
const TOKEN = `ghs_${"z".repeat(40)}`;

type ExecCall = { cmd: string[]; options?: unknown };

function jsonStdout(obj: unknown) {
	const text = JSON.stringify(obj);
	return new ReadableStream<Uint8Array>({
		start(c) {
			c.enqueue(new TextEncoder().encode(text));
			c.close();
		},
	});
}

function emptyStream() {
	return new ReadableStream<Uint8Array>({
		start(c) {
			c.close();
		},
	});
}

function makeExecProcess(result: {
	exitCode?: number;
	stdoutObj?: unknown;
	stdoutText?: string;
	stderrText?: string;
}) {
	const stdout =
		result.stdoutObj !== undefined
			? jsonStdout(result.stdoutObj)
			: result.stdoutText
				? new ReadableStream<Uint8Array>({
						start(c) {
							c.enqueue(new TextEncoder().encode(result.stdoutText));
							c.close();
						},
					})
				: emptyStream();
	const stderr = result.stderrText
		? new ReadableStream<Uint8Array>({
				start(c) {
					c.enqueue(new TextEncoder().encode(result.stderrText));
					c.close();
				},
			})
		: emptyStream();
	return {
		stdin: { close: vi.fn(async () => undefined) },
		stdout,
		stderr,
		pid: 1,
		isPty: false,
		exitCode: Promise.resolve(result.exitCode ?? 0),
		output: vi.fn(),
		kill: vi.fn(),
		resize: vi.fn(),
	};
}

function makeCtx(options?: {
	running?: boolean;
	storage?: Map<string, unknown>;
	execImpl?: (
		cmd: string[],
		opts?: unknown,
	) => Promise<ReturnType<typeof makeExecProcess>>;
	destroyImpl?: () => Promise<void>;
}) {
	const storage = options?.storage ?? new Map<string, unknown>();
	const execCalls: ExecCall[] = [];
	const container = {
		running: options?.running ?? true,
		exec: vi.fn(async (cmd: string[], opts?: unknown) => {
			execCalls.push({ cmd, options: opts });
			if (options?.execImpl) {
				return options.execImpl(cmd, opts);
			}
			return makeExecProcess({
				stdoutObj: { ok: true, code: "ok", present: true, sha: SHA_OLD },
			});
		}),
		destroy: vi.fn(async () => {
			if (options?.destroyImpl) {
				await options.destroyImpl();
			}
			container.running = false;
		}),
	};
	const ctx = {
		container,
		storage: {
			get: vi.fn(async (k: string) => storage.get(k)),
			put: vi.fn(async (k: string, v: unknown) => {
				storage.set(k, v);
			}),
			delete: vi.fn(async (k: string) => {
				storage.delete(k);
			}),
			setAlarm: vi.fn(async () => undefined),
			deleteAlarm: vi.fn(async () => undefined),
		},
		id: { toString: () => "do-id" },
	};
	return { ctx, container, execCalls, storage };
}

function makeEnv(r2Get?: (key: string) => Promise<unknown>) {
	return {
		GITHUB_APP_ID: "1",
		GITHUB_APP_PRIVATE_KEY: "k",
		BACKUP_BUCKET: {
			get: vi.fn(
				r2Get ??
					(async () => ({
						size: 4,
						body: new ReadableStream<Uint8Array>({
							start(c) {
								c.enqueue(new Uint8Array([1, 2, 3, 4]));
								c.close();
							},
						}),
					})),
			),
		},
	};
}

const basePush = {
	publicationId: "pub-1",
	executionEpoch: 1,
	installationId: 9,
	owner: "acme",
	repo: "widget",
	ref: "refs/heads/main",
	r2Key: "plan-047-smoke/b.gitbundle",
	bundleSize: 4,
	bundleSha256: DIGEST,
	proposedSha: SHA_NEW,
	expectedOldSha: SHA_OLD,
};

describe("TrustedGitExecutor orchestration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getInstallationAccessToken.mockResolvedValue(TOKEN);
		revokeInstallationAccessToken.mockResolvedValue(undefined);
	});

	it("probeRead enables read phase, returns sha, revokes and destroys", async () => {
		const { ctx, container, execCalls } = makeCtx({
			execImpl: async () =>
				makeExecProcess({
					stdoutObj: { ok: true, code: "ok", present: true, sha: SHA_OLD },
				}),
		});
		const env = makeEnv();
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec = new TrustedGitExecutor(ctx as any, env as any);
		const result = await exec.probeRead({
			publicationId: "pub-1",
			executionEpoch: 1,
			installationId: 9,
			owner: "acme",
			repo: "widget",
			ref: "refs/heads/main",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.sha).toBe(SHA_OLD);
			expect(result.revoked).toBe(true);
			expect(result.destroyed).toBe(true);
		}
		expect(exec.setOutboundByHost).toHaveBeenCalled();
		const phaseParams = (exec.setOutboundByHost as ReturnType<typeof vi.fn>)
			.mock.calls[0]?.[2] as Record<string, unknown>;
		expect(JSON.stringify(phaseParams)).not.toContain(TOKEN);
		expect(JSON.stringify(phaseParams)).not.toMatch(/ghs_/);
		expect(exec.removeOutboundByHost).toHaveBeenCalledWith("github.com");
		expect(container.destroy).toHaveBeenCalled();
		expect(execCalls[0]?.cmd).toEqual([
			"/usr/local/bin/ditto-git-executor",
			"ls-remote-ref",
			"acme",
			"widget",
			"refs/heads/main",
		]);
	});

	it("validateAndPush validates before write phase and does not mint during validation", async () => {
		const phaseOrder: string[] = [];
		const { ctx, execCalls } = makeCtx({
			execImpl: async (cmd) => {
				const sub = cmd[1];
				if (sub === "validate-bundle") {
					phaseOrder.push("validate");
					return makeExecProcess({
						stdoutObj: {
							ok: true,
							code: "ok",
							tip: SHA_NEW,
							ref: "refs/heads/main",
						},
					});
				}
				if (sub === "push-validated") {
					phaseOrder.push("push");
					return makeExecProcess({
						stdoutObj: { ok: true, code: "ok" },
					});
				}
				return makeExecProcess({ stdoutObj: { ok: true, code: "ok" } });
			},
		});
		const env = makeEnv();
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec = new TrustedGitExecutor(ctx as any, env as any);
		const setHost = exec.setOutboundByHost as ReturnType<typeof vi.fn>;
		setHost.mockImplementation(
			async (_h: string, _m: string, params: { phase: string }) => {
				phaseOrder.push(`phase:${params.phase}`);
			},
		);

		const result = await exec.validateAndPush(basePush);
		expect(result.ok).toBe(true);
		// validate before write phase enable
		expect(phaseOrder.indexOf("validate")).toBeGreaterThanOrEqual(0);
		expect(phaseOrder.indexOf("phase:write")).toBeGreaterThan(
			phaseOrder.indexOf("validate"),
		);
		expect(phaseOrder.indexOf("push")).toBeGreaterThan(
			phaseOrder.indexOf("phase:write"),
		);
		// Token mint only happens inside outbound handler, not during orchestration start.
		expect(getInstallationAccessToken).not.toHaveBeenCalled();
		// No token in persisted phase params
		for (const call of setHost.mock.calls) {
			expect(JSON.stringify(call[2])).not.toContain(TOKEN);
		}
		expect(execCalls.some((c) => c.cmd.includes("validate-bundle"))).toBe(true);
		expect(execCalls.some((c) => c.cmd.includes("push-validated"))).toBe(true);
	});

	it("validation rejection causes no write process", async () => {
		const { ctx, execCalls } = makeCtx({
			execImpl: async (cmd) => {
				if (cmd[1] === "validate-bundle") {
					return makeExecProcess({
						exitCode: 1,
						stdoutObj: { ok: false, code: "digest_mismatch" },
					});
				}
				return makeExecProcess({ stdoutObj: { ok: true, code: "ok" } });
			},
		});
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec = new TrustedGitExecutor(ctx as any, makeEnv() as any);
		const result = await exec.validateAndPush(basePush);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("validation_failed");
		expect(execCalls.some((c) => c.cmd.includes("push-validated"))).toBe(false);
		expect(exec.setOutboundByHost).not.toHaveBeenCalled();
	});

	it("reconciles proposed SHA as success without retry push", async () => {
		let pushCount = 0;
		const { ctx } = makeCtx({
			execImpl: async (cmd) => {
				const sub = cmd[1];
				if (sub === "validate-bundle") {
					return makeExecProcess({
						stdoutObj: { ok: true, code: "ok" },
					});
				}
				if (sub === "push-validated") {
					pushCount += 1;
					return makeExecProcess({
						exitCode: 1,
						stdoutObj: { ok: false, code: "push_failed" },
					});
				}
				if (sub === "ls-remote-ref") {
					return makeExecProcess({
						stdoutObj: { ok: true, code: "ok", present: true, sha: SHA_NEW },
					});
				}
				return makeExecProcess({ stdoutObj: { ok: true } });
			},
		});
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec = new TrustedGitExecutor(ctx as any, makeEnv() as any);
		const result = await exec.validateAndPush(basePush);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.code).toBe("reconciled");
			expect(result.sha).toBe(SHA_NEW);
		}
		expect(pushCount).toBe(1);
	});

	it("retries once on exact old then succeeds", async () => {
		let pushCount = 0;
		let lsCount = 0;
		const { ctx } = makeCtx({
			execImpl: async (cmd) => {
				const sub = cmd[1];
				if (sub === "validate-bundle") {
					return makeExecProcess({ stdoutObj: { ok: true, code: "ok" } });
				}
				if (sub === "push-validated") {
					pushCount += 1;
					if (pushCount === 1) {
						return makeExecProcess({
							exitCode: 1,
							stdoutObj: { ok: false, code: "push_failed" },
						});
					}
					return makeExecProcess({ stdoutObj: { ok: true, code: "ok" } });
				}
				if (sub === "ls-remote-ref") {
					lsCount += 1;
					return makeExecProcess({
						stdoutObj: { ok: true, code: "ok", present: true, sha: SHA_OLD },
					});
				}
				return makeExecProcess({ stdoutObj: { ok: true } });
			},
		});
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec = new TrustedGitExecutor(ctx as any, makeEnv() as any);
		const result = await exec.validateAndPush(basePush);
		expect(result.ok).toBe(true);
		expect(pushCount).toBe(2);
		expect(lsCount).toBe(1);
	});

	it("third remote state interrupts without retry", async () => {
		let pushCount = 0;
		const foreign = "dddddddddddddddddddddddddddddddddddddddd";
		const { ctx } = makeCtx({
			execImpl: async (cmd) => {
				const sub = cmd[1];
				if (sub === "validate-bundle") {
					return makeExecProcess({ stdoutObj: { ok: true, code: "ok" } });
				}
				if (sub === "push-validated") {
					pushCount += 1;
					return makeExecProcess({
						exitCode: 1,
						stdoutObj: { ok: false, code: "push_failed" },
					});
				}
				if (sub === "ls-remote-ref") {
					return makeExecProcess({
						stdoutObj: { ok: true, code: "ok", present: true, sha: foreign },
					});
				}
				return makeExecProcess({ stdoutObj: { ok: true } });
			},
		});
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec = new TrustedGitExecutor(ctx as any, makeEnv() as any);
		const result = await exec.validateAndPush(basePush);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("interrupted");
		expect(pushCount).toBe(1);
	});

	it("cleanup failure overrides nominal success", async () => {
		const { ctx, container } = makeCtx({
			execImpl: async (cmd) => {
				if (cmd[1] === "validate-bundle") {
					return makeExecProcess({ stdoutObj: { ok: true, code: "ok" } });
				}
				if (cmd[1] === "push-validated") {
					return makeExecProcess({ stdoutObj: { ok: true, code: "ok" } });
				}
				return makeExecProcess({ stdoutObj: { ok: true } });
			},
		});
		container.destroy = vi.fn(async () => {
			// leave running true
			container.running = true;
		});
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec = new TrustedGitExecutor(ctx as any, makeEnv() as any);
		const result = await exec.validateAndPush(basePush);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("cleanup_failed");
	});

	it("terminal identity refuses second operation; next epoch differs", async () => {
		const storage = new Map<string, unknown>();
		const { ctx } = makeCtx({
			storage,
			execImpl: async () =>
				makeExecProcess({
					stdoutObj: { ok: true, code: "ok", present: true, sha: SHA_OLD },
				}),
		});
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec = new TrustedGitExecutor(ctx as any, makeEnv() as any);
		const first = await exec.probeRead({
			publicationId: "pub-1",
			executionEpoch: 1,
			installationId: 9,
			owner: "acme",
			repo: "widget",
			ref: "refs/heads/main",
		});
		expect(first.ok).toBe(true);
		const second = await exec.probeRead({
			publicationId: "pub-1",
			executionEpoch: 1,
			installationId: 9,
			owner: "acme",
			repo: "widget",
			ref: "refs/heads/main",
		});
		expect(second.ok).toBe(false);
		if (!second.ok) expect(second.code).toBe("terminal_reuse");

		const id1 = await deriveExecutorIdentity("pub-1", 1);
		const id2 = await deriveExecutorIdentity("pub-1", 2);
		expect(id1).not.toBe(id2);
	});

	it("capacity errors before start are classified and do not run git write", async () => {
		const { ctx, execCalls } = makeCtx();
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec = new TrustedGitExecutor(ctx as any, makeEnv() as any);
		exec.start = vi.fn(async () => {
			throw new Error("capacity exceeded");
		});
		const result = await exec.validateAndPush(basePush);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("capacity");
		expect(execCalls.length).toBe(0);
	});

	it("outbound handler mints, rejects redirects, revokes on finalize", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(null, {
				status: 302,
				headers: { location: "https://evil.test" },
			});
		});
		vi.stubGlobal("fetch", fetchMock);
		const handler = TrustedGitExecutor.outboundHandlers.handleGitPhase;
		const idHash = await deriveExecutorIdentity("pub-1", 1);
		const res = await handler(
			new Request(
				"https://github.com/acme/widget.git/info/refs?service=git-upload-pack",
			),
			makeEnv() as never,
			{
				containerId: "c",
				className: "TrustedGitExecutor",
				params: {
					publicationIdHash: idHash,
					executionEpoch: 1,
					installationId: 9,
					owner: "acme",
					repo: "widget",
					phase: "read",
					expiresAtMs: Date.now() + 60_000,
				},
			},
		);
		expect(res.status).toBe(502);
		expect(getInstallationAccessToken).toHaveBeenCalledWith(
			expect.anything(),
			9,
			expect.objectContaining({
				repositories: ["widget"],
				contents: "read",
			}),
		);
		expect(revokeInstallationAccessToken).toHaveBeenCalledWith(TOKEN);
		vi.unstubAllGlobals();
	});

	it("outbound handler denies wrong host before mint", async () => {
		const handler = TrustedGitExecutor.outboundHandlers.handleGitPhase;
		const idHash = await deriveExecutorIdentity("pub-1", 1);
		const res = await handler(
			new Request(
				"https://evil.com/acme/widget.git/info/refs?service=git-upload-pack",
			),
			makeEnv() as never,
			{
				containerId: "c",
				className: "TrustedGitExecutor",
				params: {
					publicationIdHash: idHash,
					executionEpoch: 1,
					installationId: 9,
					owner: "acme",
					repo: "widget",
					phase: "read",
					expiresAtMs: Date.now() + 60_000,
				},
			},
		);
		expect(res.status).toBe(520);
		expect(getInstallationAccessToken).not.toHaveBeenCalled();
	});

	it("static outbound deny does not fall through", async () => {
		const outbound = TrustedGitExecutor.outbound as unknown as (
			req: Request,
			env: unknown,
			ctx: unknown,
		) => Promise<Response>;
		const res = await outbound(
			new Request(
				"https://github.com/acme/widget.git/info/refs?service=git-upload-pack",
			),
			makeEnv(),
			{ containerId: "c", className: "TrustedGitExecutor" },
		);
		expect(res.status).toBe(520);
	});
});
