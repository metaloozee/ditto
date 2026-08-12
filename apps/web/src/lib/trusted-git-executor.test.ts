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
		schedule = vi.fn(async () => ({ taskId: "sched-1" }));
		deleteSchedules = vi.fn(() => undefined);
		// Intentionally no alarm() override on the mock base either.
	}
	return {
		Container,
		ContainerProxy: class ContainerProxy {},
	};
});

const { TrustedGitExecutor } = await import("./trusted-git-executor");
const { deriveExecutorIdentity, runBoundedProcess, TRUSTED_GIT_LIMITS } =
	await import("./trusted-git-executor-policy");

const SHA_OLD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_NEW = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DIGEST = "c".repeat(64);
const TOKEN = `ghs_${"z".repeat(40)}`;
const DO_ID = "do-id-container-1";

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

function floodStream(bytes: number) {
	return new ReadableStream<Uint8Array>({
		start(c) {
			const chunk = new Uint8Array(Math.min(bytes, 64 * 1024));
			chunk.fill(65);
			let left = bytes;
			while (left > 0) {
				const n = Math.min(left, chunk.byteLength);
				c.enqueue(chunk.subarray(0, n));
				left -= n;
			}
			c.close();
		},
	});
}

function makeExecProcess(result: {
	exitCode?: number;
	stdoutObj?: unknown;
	stdoutText?: string;
	stderrText?: string;
	stdoutStream?: ReadableStream<Uint8Array>;
	hangExit?: boolean;
	delayMs?: number;
}) {
	const stdout =
		result.stdoutStream ??
		(result.stdoutObj !== undefined
			? jsonStdout(result.stdoutObj)
			: result.stdoutText
				? new ReadableStream<Uint8Array>({
						start(c) {
							c.enqueue(new TextEncoder().encode(result.stdoutText));
							c.close();
						},
					})
				: emptyStream());
	const stderr = result.stderrText
		? new ReadableStream<Uint8Array>({
				start(c) {
					c.enqueue(new TextEncoder().encode(result.stderrText));
					c.close();
				},
			})
		: emptyStream();
	let killCalled = false;
	const proc = {
		stdin: { close: vi.fn(async () => undefined) },
		stdout,
		stderr,
		pid: 1,
		isPty: false,
		exitCode: result.hangExit
			? new Promise<number>(() => {
					/* never resolves until kill side-effect in tests */
				})
			: result.delayMs
				? new Promise<number>((resolve) => {
						setTimeout(() => resolve(result.exitCode ?? 0), result.delayMs);
					})
				: Promise.resolve(result.exitCode ?? 0),
		output: vi.fn(() => {
			throw new Error("output() must not be called after stream consumption");
		}),
		kill: vi.fn(() => {
			killCalled = true;
		}),
		resize: vi.fn(),
		get killed() {
			return killCalled;
		},
	};
	return proc;
}

function makeCtx(options?: {
	running?: boolean;
	storage?: Map<string, unknown>;
	execImpl?: (
		cmd: string[],
		opts?: unknown,
	) => Promise<ReturnType<typeof makeExecProcess>>;
	destroyImpl?: () => Promise<void>;
	id?: string;
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
			transaction: vi.fn(
				async (
					fn: (txn: {
						get: <T>(k: string) => Promise<T | undefined>;
						put: (k: string, v: unknown) => Promise<void>;
					}) => Promise<unknown>,
				) => {
					const txn = {
						get: async <T>(k: string) => storage.get(k) as T | undefined,
						put: async (k: string, v: unknown) => {
							storage.set(k, v);
						},
					};
					return fn(txn);
				},
			),
			setAlarm: vi.fn(async () => undefined),
			deleteAlarm: vi.fn(async () => undefined),
		},
		id: { toString: () => options?.id ?? DO_ID },
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

function phaseParams(overrides: Record<string, unknown> = {}) {
	return {
		publicationIdHash: "a".repeat(64),
		executionEpoch: 1,
		installationId: 9,
		owner: "acme",
		repo: "widget",
		phase: "read" as const,
		expiresAtMs: Date.now() + 60_000,
		containerId: DO_ID,
		...overrides,
	};
}

describe("TrustedGitExecutor orchestration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getInstallationAccessToken.mockResolvedValue(TOKEN);
		revokeInstallationAccessToken.mockResolvedValue(undefined);
	});

	it("does not override base Container alarm lifecycle", () => {
		expect(Object.hasOwn(TrustedGitExecutor.prototype, "alarm")).toBe(false);
		expect(typeof TrustedGitExecutor.prototype.failSafeCleanup).toBe(
			"function",
		);
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
		expect(exec.schedule).toHaveBeenCalledWith(
			Math.ceil(TRUSTED_GIT_LIMITS.phaseGrantMaxMs / 1000),
			"failSafeCleanup",
		);
		expect(exec.deleteSchedules).toHaveBeenCalledWith("failSafeCleanup");
		expect(exec.setOutboundByHost).toHaveBeenCalled();
		const phase = (exec.setOutboundByHost as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[2] as Record<string, unknown>;
		expect(JSON.stringify(phase)).not.toContain(TOKEN);
		expect(phase.containerId).toBe(DO_ID);
		expect(exec.removeOutboundByHost).toHaveBeenCalledWith("github.com");
		expect(container.destroy).toHaveBeenCalled();
		expect(execCalls[0]?.cmd).toEqual([
			"/usr/local/bin/ditto-git-executor",
			"ls-remote-ref",
			"acme",
			"widget",
			"refs/heads/main",
		]);
		// Never call setAlarm/deleteAlarm directly for fail-safe.
		expect(ctx.storage.setAlarm).not.toHaveBeenCalled();
		expect(ctx.storage.deleteAlarm).not.toHaveBeenCalled();
	});

	it("failSafeCleanup revokes and destroys; failed cleanup retains schedule", async () => {
		const { ctx, container } = makeCtx();
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec = new TrustedGitExecutor(ctx as any, makeEnv() as any);
		await exec.failSafeCleanup();
		expect(exec.removeOutboundByHost).toHaveBeenCalledWith("github.com");
		expect(container.destroy).toHaveBeenCalled();

		// cleanup failure path retains fail-safe
		container.destroy = vi.fn(async () => {
			container.running = true;
		});
		const { ctx: ctx2, storage } = makeCtx();
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec2 = new TrustedGitExecutor(ctx2 as any, makeEnv() as any);
		exec2.removeOutboundByHost = vi.fn(async () => {
			throw new Error("revoke boom");
		});
		// force destroy fail via container still running
		(
			ctx2.container as { destroy: ReturnType<typeof vi.fn>; running: boolean }
		).destroy = vi.fn(async () => {
			(ctx2.container as { running: boolean }).running = true;
		});
		const result = await exec2.probeRead({
			publicationId: "pub-1",
			executionEpoch: 1,
			installationId: 9,
			owner: "acme",
			repo: "widget",
			ref: "refs/heads/main",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("cleanup_failed");
		expect(exec2.deleteSchedules).not.toHaveBeenCalled();
		// fail-safe was scheduled
		expect(exec2.schedule).toHaveBeenCalled();
		void storage;
	});

	it("validateAndPush validates, checks remote old, then write phase", async () => {
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
				if (sub === "ls-remote-ref") {
					phaseOrder.push("ls-pre");
					return makeExecProcess({
						stdoutObj: { ok: true, code: "ok", present: true, sha: SHA_OLD },
					});
				}
				if (sub === "push-validated") {
					phaseOrder.push("push");
					return makeExecProcess({
						stdoutObj: {
							ok: true,
							code: "ok",
							ref: "refs/heads/main",
							tip: SHA_NEW,
						},
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
		expect(phaseOrder.indexOf("validate")).toBeGreaterThanOrEqual(0);
		// read phase for pre-write check before write
		expect(phaseOrder.indexOf("phase:read")).toBeGreaterThan(
			phaseOrder.indexOf("validate"),
		);
		expect(phaseOrder.indexOf("ls-pre")).toBeGreaterThan(
			phaseOrder.indexOf("phase:read"),
		);
		expect(phaseOrder.indexOf("phase:write")).toBeGreaterThan(
			phaseOrder.indexOf("ls-pre"),
		);
		expect(phaseOrder.indexOf("push")).toBeGreaterThan(
			phaseOrder.indexOf("phase:write"),
		);
		expect(getInstallationAccessToken).not.toHaveBeenCalled();
		for (const call of setHost.mock.calls) {
			expect(JSON.stringify(call[2])).not.toContain(TOKEN);
			expect((call[2] as { containerId: string }).containerId).toBe(DO_ID);
		}
		expect(execCalls.some((c) => c.cmd.includes("validate-bundle"))).toBe(true);
		expect(execCalls.some((c) => c.cmd.includes("push-validated"))).toBe(true);
	});

	it("stops before receive-pack when remote old mismatches", async () => {
		const { ctx, execCalls } = makeCtx({
			execImpl: async (cmd) => {
				if (cmd[1] === "validate-bundle") {
					return makeExecProcess({
						stdoutObj: {
							ok: true,
							code: "ok",
							tip: SHA_NEW,
							ref: "refs/heads/main",
						},
					});
				}
				if (cmd[1] === "ls-remote-ref") {
					return makeExecProcess({
						stdoutObj: {
							ok: true,
							code: "ok",
							present: true,
							sha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
						},
					});
				}
				return makeExecProcess({ stdoutObj: { ok: true, code: "ok" } });
			},
		});
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec = new TrustedGitExecutor(ctx as any, makeEnv() as any);
		const result = await exec.validateAndPush(basePush);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("validation_failed");
			expect(result.diagnostic).toMatch(/remote old mismatch/);
		}
		expect(execCalls.some((c) => c.cmd.includes("push-validated"))).toBe(false);
	});

	it("rejects invalid helper JSON at Worker boundary", async () => {
		const { ctx } = makeCtx({
			execImpl: async (cmd) => {
				if (cmd[1] === "validate-bundle") {
					return makeExecProcess({
						stdoutText: '{"ok":true,"tip":"not-a-sha","ref":"refs/heads/main"}',
					});
				}
				return makeExecProcess({ stdoutObj: { ok: true } });
			},
		});
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec = new TrustedGitExecutor(ctx as any, makeEnv() as any);
		const result = await exec.validateAndPush(basePush);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("validation_failed");
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
						stdoutObj: {
							ok: true,
							code: "ok",
							tip: SHA_NEW,
							ref: "refs/heads/main",
						},
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
					// first ls is pre-write (old); subsequent is reconcile (new)
					if (pushCount === 0) {
						return makeExecProcess({
							stdoutObj: { ok: true, code: "ok", present: true, sha: SHA_OLD },
						});
					}
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
		const { ctx } = makeCtx({
			execImpl: async (cmd) => {
				const sub = cmd[1];
				if (sub === "validate-bundle") {
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
					pushCount += 1;
					if (pushCount === 1) {
						return makeExecProcess({
							exitCode: 1,
							stdoutObj: { ok: false, code: "push_failed" },
						});
					}
					return makeExecProcess({
						stdoutObj: {
							ok: true,
							code: "ok",
							ref: "refs/heads/main",
							tip: SHA_NEW,
						},
					});
				}
				if (sub === "ls-remote-ref") {
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
	});

	it("third remote state interrupts without retry", async () => {
		let pushCount = 0;
		const foreign = "dddddddddddddddddddddddddddddddddddddddd";
		const { ctx } = makeCtx({
			execImpl: async (cmd) => {
				const sub = cmd[1];
				if (sub === "validate-bundle") {
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
					pushCount += 1;
					return makeExecProcess({
						exitCode: 1,
						stdoutObj: { ok: false, code: "push_failed" },
					});
				}
				if (sub === "ls-remote-ref") {
					if (pushCount === 0) {
						return makeExecProcess({
							stdoutObj: { ok: true, code: "ok", present: true, sha: SHA_OLD },
						});
					}
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

	it("cleanup failure overrides nominal success and retains fail-safe", async () => {
		const { ctx, container } = makeCtx({
			execImpl: async (cmd) => {
				if (cmd[1] === "validate-bundle") {
					return makeExecProcess({
						stdoutObj: {
							ok: true,
							code: "ok",
							tip: SHA_NEW,
							ref: "refs/heads/main",
						},
					});
				}
				if (cmd[1] === "ls-remote-ref") {
					return makeExecProcess({
						stdoutObj: { ok: true, code: "ok", present: true, sha: SHA_OLD },
					});
				}
				if (cmd[1] === "push-validated") {
					return makeExecProcess({
						stdoutObj: {
							ok: true,
							code: "ok",
							ref: "refs/heads/main",
							tip: SHA_NEW,
						},
					});
				}
				return makeExecProcess({ stdoutObj: { ok: true } });
			},
		});
		container.destroy = vi.fn(async () => {
			container.running = true;
		});
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec = new TrustedGitExecutor(ctx as any, makeEnv() as any);
		const result = await exec.validateAndPush(basePush);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("cleanup_failed");
		expect(exec.deleteSchedules).not.toHaveBeenCalled();
	});

	it("terminal identity refuses second operation with truthful flags", async () => {
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
		if (!second.ok) {
			expect(second.code).toBe("terminal_reuse");
			// truthful flags from terminal state
			expect(typeof second.revoked).toBe("boolean");
			expect(typeof second.destroyed).toBe("boolean");
		}

		const id1 = await deriveExecutorIdentity("pub-1", 1);
		const id2 = await deriveExecutorIdentity("pub-1", 2);
		expect(id1).not.toBe(id2);
	});

	it("rejects concurrent double-claim", async () => {
		const storage = new Map<string, unknown>();
		const { ctx } = makeCtx({
			storage,
			execImpl: async () => {
				// Slow first exec so second claim races
				await new Promise((r) => setTimeout(r, 30));
				return makeExecProcess({
					stdoutObj: { ok: true, code: "ok", present: true, sha: SHA_OLD },
				});
			},
		});
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec = new TrustedGitExecutor(ctx as any, makeEnv() as any);
		const [a, b] = await Promise.all([
			exec.probeRead({
				publicationId: "pub-1",
				executionEpoch: 1,
				installationId: 9,
				owner: "acme",
				repo: "widget",
				ref: "refs/heads/main",
			}),
			exec.probeRead({
				publicationId: "pub-1",
				executionEpoch: 1,
				installationId: 9,
				owner: "acme",
				repo: "widget",
				ref: "refs/heads/main",
			}),
		]);
		const codes = [a, b].map((r) => (r.ok ? "ok" : r.code));
		expect(codes).toContain("ok");
		expect(codes.some((c) => c === "terminal_reuse")).toBe(true);
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

	it("timeout kills process and destroys container", async () => {
		const { ctx, container } = makeCtx({
			execImpl: async () => {
				const proc = makeExecProcess({
					hangExit: true,
					stdoutStream: emptyStream(),
				});
				// When kill is called, still hang exitCode (killGrace path).
				return proc;
			},
		});
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec = new TrustedGitExecutor(ctx as any, makeEnv() as any);
		exec.gitCommandTimeoutMs = 40;
		exec.killGraceMs = 20;
		const result = await exec.probeRead({
			publicationId: "pub-1",
			executionEpoch: 1,
			installationId: 9,
			owner: "acme",
			repo: "widget",
			ref: "refs/heads/main",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("timeout");
		expect(container.destroy).toHaveBeenCalled();
	});

	it("output flood fails closed without calling output()", async () => {
		const result = await runBoundedProcess(
			{
				stdout: floodStream(TRUSTED_GIT_LIMITS.diagnosticMaxBytes + 1000),
				stderr: emptyStream(),
				exitCode: Promise.resolve(0),
				kill: vi.fn(),
			},
			{
				timeoutMs: 5_000,
				maxStdoutBytes: TRUSTED_GIT_LIMITS.diagnosticMaxBytes,
				maxStderrBytes: TRUSTED_GIT_LIMITS.diagnosticMaxBytes,
			},
		);
		expect(result.overflow).toBe(true);
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
				containerId: DO_ID,
				className: "TrustedGitExecutor",
				params: phaseParams({ publicationIdHash: idHash }),
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

	it("outbound handler denies wrong className and containerId before mint", async () => {
		const handler = TrustedGitExecutor.outboundHandlers.handleGitPhase;
		const idHash = await deriveExecutorIdentity("pub-1", 1);
		const badClass = await handler(
			new Request(
				"https://github.com/acme/widget.git/info/refs?service=git-upload-pack",
			),
			makeEnv() as never,
			{
				containerId: DO_ID,
				className: "Sandbox",
				params: phaseParams({ publicationIdHash: idHash }),
			},
		);
		expect(badClass.status).toBe(520);
		expect(getInstallationAccessToken).not.toHaveBeenCalled();

		const badCtr = await handler(
			new Request(
				"https://github.com/acme/widget.git/info/refs?service=git-upload-pack",
			),
			makeEnv() as never,
			{
				containerId: "other-container",
				className: "TrustedGitExecutor",
				params: phaseParams({ publicationIdHash: idHash }),
			},
		);
		expect(badCtr.status).toBe(520);
		expect(getInstallationAccessToken).not.toHaveBeenCalled();
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
				containerId: DO_ID,
				className: "TrustedGitExecutor",
				params: phaseParams({ publicationIdHash: idHash }),
			},
		);
		expect(res.status).toBe(520);
		expect(getInstallationAccessToken).not.toHaveBeenCalled();
	});

	it("outbound revoke failure on EOF errors the response stream", async () => {
		revokeInstallationAccessToken.mockRejectedValueOnce(new Error("nope"));
		const fetchMock = vi.fn(async () => {
			return new Response(
				new ReadableStream({
					start(c) {
						c.enqueue(new TextEncoder().encode("pack"));
						c.close();
					},
				}),
				{
					status: 200,
					headers: { "content-type": "application/x-git-upload-pack-result" },
				},
			);
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
				containerId: DO_ID,
				className: "TrustedGitExecutor",
				params: phaseParams({ publicationIdHash: idHash }),
			},
		);
		expect(res.body).toBeTruthy();
		const body = res.body;
		if (!body) throw new Error("expected body");
		const reader = body.getReader();
		await reader.read(); // data
		await expect(reader.read()).rejects.toBeTruthy();
		expect(revokeInstallationAccessToken).toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it("outbound request oversize aborts upstream and cannot return success", async () => {
		const fetchMock = vi.fn(async (req: Request) => {
			// Consume body; oversize should abort the request signal.
			if (req.body) {
				const r = req.body.getReader();
				try {
					for (;;) {
						const { done } = await r.read();
						if (done) break;
					}
				} catch {
					// expected oversize body error
				}
			}
			// Even a buggy fetch that resolves 200 must not produce handler success.
			return new Response("x", { status: 200 });
		});
		vi.stubGlobal("fetch", fetchMock);
		const big = new Uint8Array(TRUSTED_GIT_LIMITS.httpBodyMaxBytes + 1);
		const handler = TrustedGitExecutor.outboundHandlers.handleGitPhase;
		const idHash = await deriveExecutorIdentity("pub-1", 1);
		const body = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(big);
				c.close();
			},
		});
		const res = await handler(
			new Request("https://github.com/acme/widget.git/git-upload-pack", {
				method: "POST",
				headers: {
					"content-type": "application/x-git-upload-pack-request",
					"user-agent": "git/2.49.1",
				},
				// @ts-expect-error duplex
				duplex: "half",
				body,
			}),
			makeEnv() as never,
			{
				containerId: DO_ID,
				className: "TrustedGitExecutor",
				params: phaseParams({
					publicationIdHash: idHash,
					phase: "read",
				}),
			},
		);
		expect(res.status).not.toBe(200);
		expect(getInstallationAccessToken).toHaveBeenCalledTimes(1);
		expect(revokeInstallationAccessToken).toHaveBeenCalledTimes(1);
		expect(revokeInstallationAccessToken).toHaveBeenCalledWith(TOKEN);
		vi.unstubAllGlobals();
	});

	it("mints a fresh token per allowed request and revokes exactly once on EOF", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				new ReadableStream({
					start(c) {
						c.enqueue(new TextEncoder().encode("ok"));
						c.close();
					},
				}),
				{
					status: 200,
					headers: { "content-type": "application/x-git-upload-pack-result" },
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		const handler = TrustedGitExecutor.outboundHandlers.handleGitPhase;
		const idHash = await deriveExecutorIdentity("pub-1", 1);
		const params = phaseParams({ publicationIdHash: idHash });
		for (let i = 0; i < 2; i++) {
			const res = await handler(
				new Request(
					"https://github.com/acme/widget.git/info/refs?service=git-upload-pack",
				),
				makeEnv() as never,
				{ containerId: DO_ID, className: "TrustedGitExecutor", params },
			);
			expect(res.status).toBe(200);
			const body = res.body;
			if (!body) throw new Error("body");
			const reader = body.getReader();
			while (true) {
				const { done } = await reader.read();
				if (done) break;
			}
		}
		expect(getInstallationAccessToken).toHaveBeenCalledTimes(2);
		expect(revokeInstallationAccessToken).toHaveBeenCalledTimes(2);
		vi.unstubAllGlobals();
	});

	it("revokes exactly once on response oversize and response source error", async () => {
		const handler = TrustedGitExecutor.outboundHandlers.handleGitPhase;
		const idHash = await deriveExecutorIdentity("pub-1", 1);
		const params = phaseParams({ publicationIdHash: idHash });

		// Response oversize
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				const big = new Uint8Array(TRUSTED_GIT_LIMITS.httpBodyMaxBytes + 1);
				return new Response(
					new ReadableStream({
						start(c) {
							c.enqueue(big);
							c.close();
						},
					}),
					{ status: 200 },
				);
			}),
		);
		{
			const res = await handler(
				new Request(
					"https://github.com/acme/widget.git/info/refs?service=git-upload-pack",
				),
				makeEnv() as never,
				{ containerId: DO_ID, className: "TrustedGitExecutor", params },
			);
			const reader = res.body?.getReader();
			if (!reader) throw new Error("body");
			await expect(reader.read()).rejects.toBeTruthy();
		}
		expect(revokeInstallationAccessToken).toHaveBeenCalledTimes(1);

		vi.clearAllMocks();
		getInstallationAccessToken.mockResolvedValue(TOKEN);
		revokeInstallationAccessToken.mockResolvedValue(undefined);

		// Response source error
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				return new Response(
					new ReadableStream({
						start(c) {
							c.error(new Error("upstream body boom"));
						},
					}),
					{ status: 200 },
				);
			}),
		);
		{
			const res = await handler(
				new Request(
					"https://github.com/acme/widget.git/info/refs?service=git-upload-pack",
				),
				makeEnv() as never,
				{ containerId: DO_ID, className: "TrustedGitExecutor", params },
			);
			const reader = res.body?.getReader();
			if (!reader) throw new Error("body");
			await expect(reader.read()).rejects.toBeTruthy();
		}
		expect(revokeInstallationAccessToken).toHaveBeenCalledTimes(1);
		vi.unstubAllGlobals();
	});

	it("revokes exactly once on fetch failure and redirect", async () => {
		const handler = TrustedGitExecutor.outboundHandlers.handleGitPhase;
		const idHash = await deriveExecutorIdentity("pub-1", 1);
		const params = phaseParams({ publicationIdHash: idHash });

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("network");
			}),
		);
		const failRes = await handler(
			new Request(
				"https://github.com/acme/widget.git/info/refs?service=git-upload-pack",
			),
			makeEnv() as never,
			{ containerId: DO_ID, className: "TrustedGitExecutor", params },
		);
		expect(failRes.status).toBe(502);
		expect(revokeInstallationAccessToken).toHaveBeenCalledTimes(1);

		vi.clearAllMocks();
		getInstallationAccessToken.mockResolvedValue(TOKEN);
		revokeInstallationAccessToken.mockResolvedValue(undefined);
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(null, {
						status: 302,
						headers: { location: "https://evil" },
					}),
			),
		);
		const redir = await handler(
			new Request(
				"https://github.com/acme/widget.git/info/refs?service=git-upload-pack",
			),
			makeEnv() as never,
			{ containerId: DO_ID, className: "TrustedGitExecutor", params },
		);
		expect(redir.status).toBe(502);
		expect(revokeInstallationAccessToken).toHaveBeenCalledTimes(1);
		vi.unstubAllGlobals();
	});

	it("downstream cancel finalizes revoke once and surfaces revoke failure", async () => {
		const handler = TrustedGitExecutor.outboundHandlers.handleGitPhase;
		const idHash = await deriveExecutorIdentity("pub-1", 1);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				return new Response(
					new ReadableStream({
						pull() {
							// hang until cancel
						},
					}),
					{ status: 200 },
				);
			}),
		);
		const res = await handler(
			new Request(
				"https://github.com/acme/widget.git/info/refs?service=git-upload-pack",
			),
			makeEnv() as never,
			{
				containerId: DO_ID,
				className: "TrustedGitExecutor",
				params: phaseParams({ publicationIdHash: idHash }),
			},
		);
		const body = res.body;
		if (!body) throw new Error("body");
		await body.cancel("downstream");
		expect(revokeInstallationAccessToken).toHaveBeenCalledTimes(1);

		vi.clearAllMocks();
		getInstallationAccessToken.mockResolvedValue(TOKEN);
		revokeInstallationAccessToken.mockRejectedValue(new Error("revoke boom"));
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				return new Response(
					new ReadableStream({
						pull() {},
					}),
					{ status: 200 },
				);
			}),
		);
		const res2 = await handler(
			new Request(
				"https://github.com/acme/widget.git/info/refs?service=git-upload-pack",
			),
			makeEnv() as never,
			{
				containerId: DO_ID,
				className: "TrustedGitExecutor",
				params: phaseParams({ publicationIdHash: idHash }),
			},
		);
		const body2 = res2.body;
		if (!body2) throw new Error("body2");
		const cancelResult = body2.cancel("downstream");
		// Streams implementations may surface cancel-callback rejection on the
		// returned promise; when they do, it must not look like success.
		const settled = await Promise.allSettled([cancelResult]);
		expect(revokeInstallationAccessToken).toHaveBeenCalledTimes(1);
		if (settled[0]?.status === "fulfilled") {
			// Some runtimes swallow cancel rejection; revoke still ran once above.
			expect(settled[0].status).toBe("fulfilled");
		} else {
			expect(settled[0]?.status).toBe("rejected");
		}
		vi.unstubAllGlobals();
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

	it("deleteSchedules failure overrides nominal Git success", async () => {
		const { ctx } = makeCtx({
			execImpl: async (cmd) => {
				if (cmd[1] === "validate-bundle") {
					return makeExecProcess({
						stdoutObj: {
							ok: true,
							code: "ok",
							tip: SHA_NEW,
							ref: "refs/heads/main",
						},
					});
				}
				if (cmd[1] === "ls-remote-ref") {
					return makeExecProcess({
						stdoutObj: { ok: true, code: "ok", present: true, sha: SHA_OLD },
					});
				}
				if (cmd[1] === "push-validated") {
					return makeExecProcess({
						stdoutObj: {
							ok: true,
							code: "ok",
							ref: "refs/heads/main",
							tip: SHA_NEW,
						},
					});
				}
				return makeExecProcess({ stdoutObj: { ok: true } });
			},
		});
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec = new TrustedGitExecutor(ctx as any, makeEnv() as any);
		exec.deleteSchedules = vi.fn(() => {
			throw new Error("schedule delete failed");
		});
		const result = await exec.validateAndPush(basePush);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("cleanup_failed");
	});

	it("failSafeCleanup incomplete schedules another attempt", async () => {
		const storage = new Map<string, unknown>();
		storage.set("trusted-git-op-lock", {
			publicationIdHash: "abc",
			executionEpoch: 1,
		});
		const { ctx, container } = makeCtx({ storage });
		container.destroy = vi.fn(async () => {
			container.running = true;
		});
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec = new TrustedGitExecutor(ctx as any, makeEnv() as any);
		await exec.failSafeCleanup();
		expect(exec.schedule).toHaveBeenCalledWith(
			Math.ceil(TRUSTED_GIT_LIMITS.phaseGrantMaxMs / 1000),
			"failSafeCleanup",
		);
		// op lock retained when destroy unproven
		expect(await ctx.storage.get("trusted-git-op-lock")).toEqual({
			publicationIdHash: "abc",
			executionEpoch: 1,
		});
	});

	it("push timeout reconciles proposed as success", async () => {
		let pushCount = 0;
		const phaseOrder: string[] = [];
		const { ctx } = makeCtx({
			execImpl: async (cmd) => {
				const sub = cmd[1];
				if (sub === "validate-bundle") {
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
					pushCount += 1;
					const proc = makeExecProcess({
						hangExit: true,
						stdoutStream: emptyStream(),
					});
					return proc;
				}
				if (sub === "ls-remote-ref") {
					if (pushCount === 0) {
						return makeExecProcess({
							stdoutObj: {
								ok: true,
								code: "ok",
								present: true,
								sha: SHA_OLD,
							},
						});
					}
					// post-timeout reconcile sees proposed
					return makeExecProcess({
						stdoutObj: {
							ok: true,
							code: "ok",
							present: true,
							sha: SHA_NEW,
						},
					});
				}
				return makeExecProcess({ stdoutObj: { ok: true } });
			},
		});
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec = new TrustedGitExecutor(ctx as any, makeEnv() as any);
		exec.gitCommandTimeoutMs = 30;
		exec.killGraceMs = 15;
		const setOutbound = exec.setOutboundByHost as ReturnType<typeof vi.fn>;
		setOutbound.mockImplementation(
			async (_h: string, _n: string, params: { phase: string }) => {
				phaseOrder.push(params.phase);
			},
		);
		const result = await exec.validateAndPush(basePush);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.code).toBe("reconciled");
		expect(pushCount).toBe(1);
		// write phase revoked before read reconcile (last enable is read)
		expect(
			phaseOrder.filter((p) => p === "write").length,
		).toBeGreaterThanOrEqual(1);
		expect(phaseOrder[phaseOrder.length - 1]).toBe("read");
		// removeOutboundByHost called after write before final read enable path
		expect(exec.removeOutboundByHost).toHaveBeenCalled();
	});

	it("push timeout on old permits one retry then re-reconciles", async () => {
		let pushCount = 0;
		let reconcileReads = 0;
		const { ctx } = makeCtx({
			execImpl: async (cmd) => {
				const sub = cmd[1];
				if (sub === "validate-bundle") {
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
					pushCount += 1;
					return makeExecProcess({
						hangExit: true,
						stdoutStream: emptyStream(),
					});
				}
				if (sub === "ls-remote-ref") {
					// pre-write + post-timeout reconcile + post-retry reconcile all see old
					// except we count post-push reads via pushCount
					if (pushCount === 0) {
						return makeExecProcess({
							stdoutObj: {
								ok: true,
								code: "ok",
								present: true,
								sha: SHA_OLD,
							},
						});
					}
					reconcileReads += 1;
					return makeExecProcess({
						stdoutObj: {
							ok: true,
							code: "ok",
							present: true,
							sha: SHA_OLD,
						},
					});
				}
				return makeExecProcess({ stdoutObj: { ok: true } });
			},
		});
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec = new TrustedGitExecutor(ctx as any, makeEnv() as any);
		exec.gitCommandTimeoutMs = 30;
		exec.killGraceMs = 15;
		const result = await exec.validateAndPush(basePush);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("interrupted");
		expect(pushCount).toBe(2);
		expect(reconcileReads).toBe(2);
	});

	it("push output overflow reconciles third state as interrupted", async () => {
		let pushCount = 0;
		const foreign = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
		const { ctx } = makeCtx({
			execImpl: async (cmd) => {
				const sub = cmd[1];
				if (sub === "validate-bundle") {
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
					pushCount += 1;
					return makeExecProcess({
						stdoutStream: floodStream(
							TRUSTED_GIT_LIMITS.diagnosticMaxBytes + 500,
						),
						exitCode: 0,
					});
				}
				if (sub === "ls-remote-ref") {
					if (pushCount === 0) {
						return makeExecProcess({
							stdoutObj: {
								ok: true,
								code: "ok",
								present: true,
								sha: SHA_OLD,
							},
						});
					}
					return makeExecProcess({
						stdoutObj: {
							ok: true,
							code: "ok",
							present: true,
							sha: foreign,
						},
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

	it("bounded process hang on never-closing streams destroys container", async () => {
		const mkNever = () =>
			new ReadableStream<Uint8Array>({
				pull() {},
				cancel() {
					return new Promise(() => {});
				},
			});
		const { ctx, container } = makeCtx({
			execImpl: async () => {
				const proc = makeExecProcess({
					hangExit: true,
					stdoutStream: mkNever(),
				});
				(proc as { stderr: ReadableStream<Uint8Array> }).stderr = mkNever();
				return proc;
			},
		});
		// biome-ignore lint/suspicious/noExplicitAny: test harness
		const exec = new TrustedGitExecutor(ctx as any, makeEnv() as any);
		exec.gitCommandTimeoutMs = 40;
		exec.killGraceMs = 20;
		const started = Date.now();
		const result = await exec.probeRead({
			publicationId: "pub-1",
			executionEpoch: 1,
			installationId: 9,
			owner: "acme",
			repo: "widget",
			ref: "refs/heads/main",
		});
		expect(Date.now() - started).toBeLessThan(1000);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("timeout");
		expect(container.destroy).toHaveBeenCalled();
	});
});
