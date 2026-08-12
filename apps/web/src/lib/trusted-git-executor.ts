/**
 * Trusted Git Executor — ephemeral Container-backed Durable Object.
 *
 * Narrow RPC only. No project code, no generic shell/process API, no
 * production caller wiring. Credentials stay in the Worker outbound handler.
 *
 * Does NOT override Container.alarm() — fail-safe uses base schedule().
 */
import { Container } from "@cloudflare/containers";
import {
	type GitHubAppEnv,
	getInstallationAccessToken,
	revokeInstallationAccessToken,
} from "#/lib/github-app";
import {
	assertPhaseGrantNonSecret,
	boundReadableStream,
	buildPhaseGrant,
	buildUpstreamGitRequest,
	classifySmartHttpRequest,
	contentsPermissionForPhase,
	countingTransform,
	deriveExecutorIdentity,
	isRedirectStatus,
	makeErrorResult,
	makeSuccessResult,
	type PhaseGrantParams,
	parseHelperLsRemote,
	parseHelperPush,
	parseHelperValidate,
	reconcileWriteRef,
	runBoundedProcess,
	TRUSTED_GIT_CLASS_NAME,
	TRUSTED_GIT_GITHUB_HOST,
	TRUSTED_GIT_LIMITS,
	TrustedGitPolicyError,
	type TrustedGitSafeResult,
	validateContainerId,
	validateProbeInput,
	validatePushInput,
} from "#/lib/trusted-git-executor-policy";

/** Narrow env: never full Env; never the project container binding. */
export type TrustedGitExecutorEnv = GitHubAppEnv & {
	BACKUP_BUCKET: R2Bucket;
};

type TerminalState = {
	terminal: true;
	publicationIdHash: string;
	executionEpoch: number;
	revoked: boolean;
	destroyed: boolean;
};

type OpClaim = {
	publicationIdHash: string;
	executionEpoch: number;
};

const HELPER = "/usr/local/bin/ditto-git-executor";
const STATE_KEY_TERMINAL = "trusted-git-terminal";
const STATE_KEY_OP = "trusted-git-op-lock";
const FAILSAFE_CALLBACK = "failSafeCleanup";

function asGitHubEnv(env: TrustedGitExecutorEnv): GitHubAppEnv {
	return {
		GITHUB_APP_ID: env.GITHUB_APP_ID,
		GITHUB_APP_PRIVATE_KEY: env.GITHUB_APP_PRIVATE_KEY,
	};
}

function parseJsonUnknown(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return null;
	}
}

export class TrustedGitExecutor extends Container<TrustedGitExecutorEnv> {
	// No defaultPort — no listening public/container port.
	sleepAfter = "2m";
	enableInternet = false;
	interceptHttps = true;
	envVars: Record<string, string> = {
		LANG: "C",
		LC_ALL: "C",
	};
	entrypoint = [HELPER, "hold"];

	/**
	 * Test-only timing overrides. Production keeps package defaults.
	 * Not part of the RPC surface.
	 */
	gitCommandTimeoutMs: number = TRUSTED_GIT_LIMITS.gitCommandTimeoutMs;
	killGraceMs = 2_000;

	/** Static catch-all deny — required so allowedHosts cannot fall through. */
	static outbound = async (): Promise<Response> =>
		new Response("Origin is disallowed", { status: 520 });

	static outboundHandlers = {
		denyAll: async (): Promise<Response> =>
			new Response("Origin is disallowed", { status: 520 }),

		handleGitPhase: async (
			request: Request,
			env: TrustedGitExecutorEnv,
			ctx: {
				containerId: string;
				className: string;
				params?: PhaseGrantParams;
			},
		): Promise<Response> => {
			const params = ctx.params;
			if (!params) {
				return new Response("Origin is disallowed", { status: 520 });
			}
			try {
				assertPhaseGrantNonSecret(params);
				if (ctx.className !== TRUSTED_GIT_CLASS_NAME) {
					return new Response("Origin is disallowed", { status: 520 });
				}
				const classified = classifySmartHttpRequest(
					request,
					params,
					Date.now(),
					{
						containerId: ctx.containerId,
						className: ctx.className,
					},
				);
				const permission = contentsPermissionForPhase(params.phase);
				const token = await getInstallationAccessToken(
					asGitHubEnv(env),
					params.installationId,
					{
						repositories: [params.repo],
						contents: permission,
					},
				);

				let finalized = false;
				const finalize = async () => {
					if (finalized) return;
					finalized = true;
					await revokeInstallationAccessToken(token);
				};

				const failAfterFinalize = async (
					status: number,
					message: string,
				): Promise<Response> => {
					try {
						await finalize();
					} catch {
						return new Response("revoke failed", { status: 502 });
					}
					return new Response(message, { status });
				};

				// Abort upstream fetch on request oversize/source error so the
				// handler cannot observe a successful Response afterward.
				const upstreamAbort = new AbortController();
				let requestFailed = false;
				let requestFailMessage = "request failed";

				const failRequest = (message: string) => {
					requestFailed = true;
					requestFailMessage = message;
					if (!upstreamAbort.signal.aborted) {
						upstreamAbort.abort();
					}
				};

				// Bound REQUEST body (POST RPC) before upstream fetch.
				let outboundBody: ReadableStream<Uint8Array> | null = null;
				if (request.body) {
					const reader = request.body.getReader();
					let seen = 0;
					outboundBody = new ReadableStream<Uint8Array>({
						async pull(controller) {
							try {
								const { done, value } = await reader.read();
								if (done) {
									controller.close();
									return;
								}
								seen += value.byteLength;
								if (seen > TRUSTED_GIT_LIMITS.httpBodyMaxBytes) {
									failRequest("request oversize");
									try {
										await reader.cancel("oversize");
									} catch {
										// ignore
									}
									try {
										await finalize();
									} catch {
										// still error the body
									}
									controller.error(
										new TrustedGitPolicyError("denied", "request oversize"),
									);
									return;
								}
								controller.enqueue(value);
							} catch (err) {
								failRequest("request source error");
								try {
									await finalize();
								} catch {
									// ignore
								}
								controller.error(err);
							}
						},
						async cancel() {
							failRequest("request cancelled");
							try {
								await reader.cancel();
							} finally {
								if (!finalized) {
									// Surface revoke failure when cancel can propagate it.
									await finalize();
								}
							}
						},
					});
				}

				const upstreamReq = buildUpstreamGitRequest(
					request,
					classified,
					token,
					outboundBody,
				);

				let upstream: Response;
				try {
					upstream = await fetch(
						new Request(upstreamReq, { signal: upstreamAbort.signal }),
					);
				} catch {
					return failAfterFinalize(
						502,
						requestFailed ? requestFailMessage : "upstream failed",
					);
				}

				// Even if a buggy fetch resolves after body failure, never succeed.
				if (requestFailed || upstreamAbort.signal.aborted) {
					try {
						await upstream.body?.cancel();
					} catch {
						// ignore
					}
					return failAfterFinalize(
						502,
						requestFailed ? requestFailMessage : "request aborted",
					);
				}

				if (isRedirectStatus(upstream.status)) {
					return failAfterFinalize(502, "redirect denied");
				}

				const headers = new Headers();
				const ctype = upstream.headers.get("content-type");
				if (ctype) headers.set("content-type", ctype);
				const cache = upstream.headers.get("cache-control");
				if (cache) headers.set("cache-control", cache);

				if (!upstream.body) {
					try {
						await finalize();
					} catch {
						return new Response("revoke failed", { status: 502 });
					}
					return new Response(null, {
						status: upstream.status,
						headers,
					});
				}

				// Response stream: finalize exactly once; revoke failure errors stream
				// before close so success cannot complete without revoke.
				const body = boundReadableStream(
					upstream.body,
					TRUSTED_GIT_LIMITS.httpBodyMaxBytes,
					finalize,
				);
				return new Response(body, {
					status: upstream.status,
					headers,
				});
			} catch (err) {
				if (err instanceof TrustedGitPolicyError) {
					return new Response("Origin is disallowed", { status: 520 });
				}
				return new Response("Origin is disallowed", { status: 520 });
			}
		},
	};

	// --- Internal lifecycle helpers ---

	/** Non-secret container id used to bind phase grants. */
	private currentContainerId(): string {
		const id = this.ctx.id?.toString?.() ?? "unknown";
		// Bound and sanitize — DO ids are opaque non-secret.
		const bounded = id.slice(0, TRUSTED_GIT_LIMITS.containerIdMaxBytes);
		validateContainerId(bounded);
		return bounded;
	}

	private async markTerminal(
		publicationIdHash: string,
		executionEpoch: number,
		flags: { revoked: boolean; destroyed: boolean },
	) {
		const state: TerminalState = {
			terminal: true,
			publicationIdHash,
			executionEpoch,
			revoked: flags.revoked,
			destroyed: flags.destroyed,
		};
		await this.ctx.storage.put(STATE_KEY_TERMINAL, state);
	}

	private async isTerminal(): Promise<TerminalState | null> {
		return (
			(await this.ctx.storage.get<TerminalState>(STATE_KEY_TERMINAL)) ?? null
		);
	}

	/**
	 * Atomically claim an operation for this publication+epoch.
	 * Rejects concurrent or mismatched claims.
	 */
	private async claimOperation(
		publicationIdHash: string,
		executionEpoch: number,
	): Promise<"ok" | "busy" | "mismatch" | "terminal"> {
		const storage = this.ctx.storage;
		// Prefer transactional claim when available.
		const txnFn = (
			storage as DurableObjectStorage & {
				transaction?: <T>(
					c: (txn: DurableObjectTransaction) => Promise<T>,
				) => Promise<T>;
			}
		).transaction;

		const run = async (store: {
			get: <T>(k: string) => Promise<T | undefined>;
			put: (k: string, v: unknown) => Promise<void>;
		}): Promise<"ok" | "busy" | "mismatch" | "terminal"> => {
			const terminal = await store.get<TerminalState>(STATE_KEY_TERMINAL);
			if (terminal?.terminal) {
				return "terminal";
			}
			const existing = await store.get<OpClaim>(STATE_KEY_OP);
			if (existing) {
				if (
					existing.publicationIdHash !== publicationIdHash ||
					existing.executionEpoch !== executionEpoch
				) {
					return "mismatch";
				}
				return "busy";
			}
			await store.put(STATE_KEY_OP, {
				publicationIdHash,
				executionEpoch,
			} satisfies OpClaim);
			return "ok";
		};

		if (typeof txnFn === "function") {
			return (await txnFn.call(storage, async (txn) => run(txn))) as
				| "ok"
				| "busy"
				| "mismatch"
				| "terminal";
		}
		return run(storage);
	}

	private async scheduleFailSafe(): Promise<void> {
		// schedule(when: number) = delay in seconds per @cloudflare/containers@0.3.7
		const delaySec = Math.ceil(TRUSTED_GIT_LIMITS.phaseGrantMaxMs / 1000);
		await this.schedule(delaySec, FAILSAFE_CALLBACK);
	}

	/**
	 * Clear fail-safe only after full successful cleanup.
	 * Returns false when deleteSchedules fails — caller must treat as cleanup_failed.
	 */
	private clearFailSafe(): boolean {
		try {
			this.deleteSchedules(FAILSAFE_CALLBACK);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Fail-safe callback invoked by base Container.alarm via schedule().
	 * Must remain a method on this class (schedule looks up by name).
	 * Base alarm deletes the one-time schedule after the callback, so incomplete
	 * cleanup must schedule a replacement retry before returning.
	 */
	async failSafeCleanup(): Promise<void> {
		let revoked = false;
		let destroyed = false;
		let opCleared = false;

		try {
			await this.removeOutboundByHost(TRUSTED_GIT_GITHUB_HOST);
			await this.setOutboundHandler("denyAll");
			revoked = true;
		} catch {
			try {
				await this.setOutboundHandler("denyAll");
			} catch {
				// keep revoked=false
			}
		}

		destroyed = await this.destroyAndProve();

		// Only clear non-secret op state after phase deny + destruction proof.
		if (revoked && destroyed) {
			try {
				await this.ctx.storage.delete(STATE_KEY_OP);
				opCleared = true;
			} catch {
				opCleared = false;
			}
		}

		if (!(revoked && destroyed && opCleared)) {
			// Replacement fail-safe: base already consumed the prior one-shot schedule.
			try {
				await this.scheduleFailSafe();
			} catch {
				// nothing else available
			}
		}
	}

	private async ensureContainerStarted(): Promise<void> {
		await this.start({
			enableInternet: false,
			entrypoint: [HELPER, "hold"],
			envVars: { LANG: "C", LC_ALL: "C" },
		});
	}

	private async enablePhase(params: PhaseGrantParams): Promise<void> {
		assertPhaseGrantNonSecret(params);
		await this.setOutboundByHost(
			TRUSTED_GIT_GITHUB_HOST,
			"handleGitPhase",
			params,
		);
	}

	/** Throws on failure — callers must not swallow for success paths. */
	private async revokePhase(): Promise<void> {
		await this.removeOutboundByHost(TRUSTED_GIT_GITHUB_HOST);
		await this.setOutboundHandler("denyAll");
	}

	private async destroyAndProve(): Promise<boolean> {
		try {
			if (this.ctx.container) {
				await this.ctx.container.destroy();
			}
			if (this.ctx.container?.running) {
				return false;
			}
			return true;
		} catch {
			return false;
		}
	}

	private async execHelper(
		argv: string[],
		options?: {
			stdin?: ReadableStream<Uint8Array>;
			timeoutMs?: number;
		},
	): Promise<{
		exitCode: number;
		stdout: string;
		stderr: string;
		timedOut: boolean;
		overflow: boolean;
		killed: boolean;
		started: boolean;
		proc: { kill: (signal?: number) => void } | null;
	}> {
		const timeoutMs = options?.timeoutMs ?? this.gitCommandTimeoutMs;
		const container = this.ctx.container;
		if (!container) {
			throw new TrustedGitPolicyError("internal", "no container");
		}

		const proc = await container.exec([HELPER, ...argv], {
			stdin: options?.stdin ?? "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		const started = true;

		if (!options?.stdin && proc.stdin) {
			await proc.stdin.close();
		}

		try {
			const result = await runBoundedProcess(proc, {
				timeoutMs,
				maxStdoutBytes: TRUSTED_GIT_LIMITS.diagnosticMaxBytes,
				maxStderrBytes: TRUSTED_GIT_LIMITS.diagnosticMaxBytes,
				killGraceMs: this.killGraceMs,
			});
			return {
				...result,
				started,
				proc,
			};
		} catch (err) {
			try {
				proc.kill();
			} catch {
				// ignore
			}
			throw err;
		}
	}

	/**
	 * Full cleanup. Returns flags. Does NOT clear fail-safe on any failure.
	 * Cleanup errors must be visible to callers (override success).
	 */
	private async cleanupFinally(options: {
		child?: { kill: (signal?: number) => void } | null;
		publicationIdHash?: string;
		executionEpoch?: number;
		markTerminal?: boolean;
	}): Promise<{ revoked: boolean; destroyed: boolean; cleaned: boolean }> {
		let revoked = false;
		let destroyed = false;
		let opCleared = false;
		let terminalOk = true;

		try {
			options.child?.kill();
		} catch {
			// continue
		}

		try {
			await this.revokePhase();
			revoked = true;
		} catch {
			revoked = false;
		}

		destroyed = await this.destroyAndProve();

		try {
			await this.ctx.storage.delete(STATE_KEY_OP);
			opCleared = true;
		} catch {
			opCleared = false;
		}

		if (
			options.markTerminal &&
			options.publicationIdHash &&
			options.executionEpoch
		) {
			try {
				await this.markTerminal(
					options.publicationIdHash,
					options.executionEpoch,
					{ revoked, destroyed },
				);
			} catch {
				terminalOk = false;
			}
		}

		let cleaned = revoked && destroyed && opCleared && terminalOk;
		if (cleaned) {
			// deleteSchedules failure must override nominal Git success.
			if (!this.clearFailSafe()) {
				cleaned = false;
			}
		}
		// If not cleaned, fail-safe schedule is intentionally retained.
		return { revoked, destroyed, cleaned };
	}

	// --- Narrow RPC surface ---

	/**
	 * Read-only probe of an exact remote ref via stock git ls-remote through
	 * the Worker-side smart-HTTP proxy. Returns only SHA + safe flags.
	 */
	async probeRead(raw: {
		publicationId: string;
		executionEpoch: number;
		installationId: number;
		owner: string;
		repo: string;
		ref: string;
	}): Promise<TrustedGitSafeResult> {
		let publicationIdHash = "";
		let child: { kill: (signal?: number) => void } | null = null;

		try {
			const input = validateProbeInput(raw);
			publicationIdHash = await deriveExecutorIdentity(
				input.publicationId,
				input.executionEpoch,
			);

			const terminal = await this.isTerminal();
			if (terminal) {
				// Prove or report truthful cleanup flags — do not claim success cleanup blindly.
				let revoked = terminal.revoked;
				let destroyed = terminal.destroyed;
				if (!destroyed) {
					destroyed = await this.destroyAndProve();
				}
				if (!revoked) {
					try {
						await this.revokePhase();
						revoked = true;
					} catch {
						revoked = false;
					}
				}
				return makeErrorResult({
					code: "terminal_reuse",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked,
					destroyed,
				});
			}

			const claim = await this.claimOperation(
				publicationIdHash,
				input.executionEpoch,
			);
			if (claim === "terminal" || claim === "busy" || claim === "mismatch") {
				return makeErrorResult({
					code: claim === "mismatch" ? "identity_mismatch" : "terminal_reuse",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked: false,
					destroyed: false,
				});
			}

			await this.scheduleFailSafe();
			await this.ensureContainerStarted();

			const grant = buildPhaseGrant({
				publicationIdHash,
				executionEpoch: input.executionEpoch,
				installationId: input.installationId,
				owner: input.owner,
				repo: input.repo,
				phase: "read",
				containerId: this.currentContainerId(),
			});
			await this.enablePhase(grant);

			const result = await this.execHelper([
				"ls-remote-ref",
				input.owner,
				input.repo,
				input.ref,
			]);
			child = result.proc;

			if (result.timedOut || result.overflow) {
				const cleanup = await this.cleanupFinally({
					child,
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					markTerminal: true,
				});
				return makeErrorResult({
					code: result.timedOut ? "timeout" : "validation_failed",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked: cleanup.revoked,
					destroyed: cleanup.destroyed,
					diagnostic: result.overflow ? "output overflow" : "timeout",
				});
			}

			const cleanup = await this.cleanupFinally({
				child,
				publicationIdHash,
				executionEpoch: input.executionEpoch,
				markTerminal: true,
			});

			if (!cleanup.cleaned) {
				return makeErrorResult({
					code: "cleanup_failed",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked: cleanup.revoked,
					destroyed: cleanup.destroyed,
					diagnostic: result.stderr || result.stdout,
				});
			}

			const parsed = parseHelperLsRemote(parseJsonUnknown(result.stdout));
			if (result.exitCode !== 0 || !parsed.ok) {
				return makeErrorResult({
					code: "upstream",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked: true,
					destroyed: true,
					diagnostic: parsed.ok === false ? parsed.code : "ls-remote",
				});
			}

			return makeSuccessResult({
				publicationIdHash,
				executionEpoch: input.executionEpoch,
				ref: input.ref,
				sha: parsed.present ? parsed.sha : null,
				present: parsed.present,
				revoked: true,
				destroyed: true,
			});
		} catch (err) {
			const cleanup = await this.cleanupFinally({
				child,
				publicationIdHash: publicationIdHash || undefined,
				executionEpoch:
					typeof raw.executionEpoch === "number"
						? raw.executionEpoch
						: undefined,
				markTerminal: Boolean(publicationIdHash),
			});
			const code = err instanceof TrustedGitPolicyError ? err.code : "internal";
			return makeErrorResult({
				code,
				publicationIdHash: publicationIdHash || undefined,
				executionEpoch:
					typeof raw.executionEpoch === "number"
						? raw.executionEpoch
						: undefined,
				revoked: cleanup.revoked,
				destroyed: cleanup.destroyed,
				diagnostic: err instanceof Error ? err.message : "error",
			});
		}
	}

	/**
	 * Validate a bounded R2 bundle in a fresh quarantine, confirm remote old
	 * tip via read phase, then non-force push. Order is load-bearing.
	 */
	async validateAndPush(raw: {
		publicationId: string;
		executionEpoch: number;
		installationId: number;
		owner: string;
		repo: string;
		ref: string;
		r2Key: string;
		bundleSize: number;
		bundleSha256: string;
		proposedSha: string;
		expectedOldSha: string | null;
	}): Promise<TrustedGitSafeResult> {
		let publicationIdHash = "";
		let processStarted = false;
		let child: { kill: (signal?: number) => void } | null = null;
		let capacityRetries = 0;

		try {
			const input = validatePushInput(raw);
			publicationIdHash = await deriveExecutorIdentity(
				input.publicationId,
				input.executionEpoch,
			);

			const terminal = await this.isTerminal();
			if (terminal) {
				let revoked = terminal.revoked;
				let destroyed = terminal.destroyed;
				if (!destroyed) {
					destroyed = await this.destroyAndProve();
				}
				if (!revoked) {
					try {
						await this.revokePhase();
						revoked = true;
					} catch {
						revoked = false;
					}
				}
				return makeErrorResult({
					code: "terminal_reuse",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked,
					destroyed,
				});
			}

			const claim = await this.claimOperation(
				publicationIdHash,
				input.executionEpoch,
			);
			if (claim === "terminal" || claim === "busy" || claim === "mismatch") {
				return makeErrorResult({
					code: claim === "mismatch" ? "identity_mismatch" : "terminal_reuse",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked: false,
					destroyed: false,
				});
			}

			await this.scheduleFailSafe();

			// Start container with deny-all; no egress phase yet.
			let started = false;
			for (
				let attempt = 0;
				attempt <= TRUSTED_GIT_LIMITS.capacityRetries;
				attempt++
			) {
				try {
					await this.ensureContainerStarted();
					started = true;
					break;
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					const capacity = /capacit|rate|limit|throttl|too many|resource/i.test(
						msg,
					);
					if (!capacity || attempt === TRUSTED_GIT_LIMITS.capacityRetries) {
						const cleanup = await this.cleanupFinally({
							publicationIdHash,
							executionEpoch: input.executionEpoch,
							markTerminal: true,
						});
						return makeErrorResult({
							code: capacity ? "capacity" : "internal",
							publicationIdHash,
							executionEpoch: input.executionEpoch,
							revoked: cleanup.revoked,
							destroyed: cleanup.destroyed,
							diagnostic: msg,
						});
					}
					capacityRetries += 1;
					await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
				}
			}
			if (!started) {
				const cleanup = await this.cleanupFinally({
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					markTerminal: true,
				});
				return makeErrorResult({
					code: "capacity",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked: cleanup.revoked,
					destroyed: cleanup.destroyed,
				});
			}

			// R2 stream + validate-bundle with NO egress phase.
			const obj = await this.env.BACKUP_BUCKET.get(input.r2Key);
			if (!obj) {
				const cleanup = await this.cleanupFinally({
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					markTerminal: true,
				});
				return makeErrorResult({
					code: "validation_failed",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked: cleanup.revoked,
					destroyed: cleanup.destroyed,
					diagnostic: "r2 missing",
				});
			}
			if (obj.size !== input.bundleSize) {
				const cleanup = await this.cleanupFinally({
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					markTerminal: true,
				});
				return makeErrorResult({
					code: "validation_failed",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked: cleanup.revoked,
					destroyed: cleanup.destroyed,
					diagnostic: "r2 size",
				});
			}

			const oldArg = input.expectedOldSha ?? "-";
			const validateArgv = [
				"validate-bundle",
				input.bundleSha256,
				String(input.bundleSize),
				input.ref,
				input.proposedSha,
				oldArg,
			];

			const container = this.ctx.container;
			if (!container) {
				throw new TrustedGitPolicyError("internal", "no container");
			}

			let counted = 0;
			const countedBody = obj.body.pipeThrough(
				countingTransform((n) => {
					counted = n;
				}, input.bundleSize),
			);

			const validateProc = await container.exec([HELPER, ...validateArgv], {
				stdin: countedBody,
				stdout: "pipe",
				stderr: "pipe",
			});
			const validateResult = await runBoundedProcess(validateProc, {
				timeoutMs: this.gitCommandTimeoutMs,
				maxStdoutBytes: TRUSTED_GIT_LIMITS.diagnosticMaxBytes,
				maxStderrBytes: TRUSTED_GIT_LIMITS.diagnosticMaxBytes,
				killGraceMs: this.killGraceMs,
			});

			if (validateResult.timedOut || validateResult.overflow) {
				const cleanup = await this.cleanupFinally({
					child: validateProc,
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					markTerminal: true,
				});
				return makeErrorResult({
					code: validateResult.timedOut ? "timeout" : "validation_failed",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked: cleanup.revoked,
					destroyed: cleanup.destroyed,
					diagnostic: validateResult.overflow ? "output overflow" : "timeout",
				});
			}

			const validateParsed = parseHelperValidate(
				parseJsonUnknown(validateResult.stdout),
				{ ref: input.ref, tip: input.proposedSha },
			);

			if (validateResult.exitCode !== 0 || !validateParsed.ok) {
				const cleanup = await this.cleanupFinally({
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					markTerminal: true,
				});
				return makeErrorResult({
					code: "validation_failed",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked: cleanup.revoked,
					destroyed: cleanup.destroyed,
					diagnostic:
						validateParsed.ok === false
							? validateParsed.code
							: validateResult.stderr,
				});
			}
			if (counted > 0 && counted !== input.bundleSize) {
				const cleanup = await this.cleanupFinally({
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					markTerminal: true,
				});
				return makeErrorResult({
					code: "validation_failed",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked: cleanup.revoked,
					destroyed: cleanup.destroyed,
					diagnostic: "stream size",
				});
			}

			// Pre-write remote check: fresh READ phase ls-remote of exact destination.
			const readGrant = buildPhaseGrant({
				publicationIdHash,
				executionEpoch: input.executionEpoch,
				installationId: input.installationId,
				owner: input.owner,
				repo: input.repo,
				phase: "read",
				containerId: this.currentContainerId(),
			});
			await this.enablePhase(readGrant);
			const lsPre = await this.execHelper([
				"ls-remote-ref",
				input.owner,
				input.repo,
				input.ref,
			]);
			// Revoke read before enabling write — failure blocks write.
			try {
				await this.revokePhase();
			} catch {
				const cleanup = await this.cleanupFinally({
					child: lsPre.proc,
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					markTerminal: true,
				});
				return makeErrorResult({
					code: "cleanup_failed",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked: cleanup.revoked,
					destroyed: cleanup.destroyed,
					diagnostic: "read phase revoke failed",
				});
			}

			if (lsPre.timedOut || lsPre.overflow) {
				const cleanup = await this.cleanupFinally({
					child: lsPre.proc,
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					markTerminal: true,
				});
				return makeErrorResult({
					code: lsPre.timedOut ? "timeout" : "validation_failed",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked: cleanup.revoked,
					destroyed: cleanup.destroyed,
				});
			}

			const preRemote = parseHelperLsRemote(parseJsonUnknown(lsPre.stdout));
			if (lsPre.exitCode !== 0 || !preRemote.ok) {
				const cleanup = await this.cleanupFinally({
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					markTerminal: true,
				});
				return makeErrorResult({
					code: "validation_failed",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked: cleanup.revoked,
					destroyed: cleanup.destroyed,
					diagnostic: "pre-write ls-remote",
				});
			}
			const observedPre = preRemote.present ? preRemote.sha : null;
			if (observedPre !== input.expectedOldSha) {
				// Mismatch stops before receive-pack.
				const cleanup = await this.cleanupFinally({
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					markTerminal: true,
				});
				return makeErrorResult({
					code: "validation_failed",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked: cleanup.revoked,
					destroyed: cleanup.destroyed,
					diagnostic: "remote old mismatch",
				});
			}

			// Enable write phase only after successful validation + remote old match.
			const writeGrant = buildPhaseGrant({
				publicationIdHash,
				executionEpoch: input.executionEpoch,
				installationId: input.installationId,
				owner: input.owner,
				repo: input.repo,
				phase: "write",
				containerId: this.currentContainerId(),
			});
			await this.enablePhase(writeGrant);

			const pushArgv = [
				"push-validated",
				input.owner,
				input.repo,
				input.ref,
				input.proposedSha,
			];

			const pushOnce = async () => {
				const proc = await container.exec([HELPER, ...pushArgv], {
					stdin: "pipe",
					stdout: "pipe",
					stderr: "pipe",
				});
				processStarted = true;
				child = proc;
				if (proc.stdin) {
					await proc.stdin.close();
				}
				const result = await runBoundedProcess(proc, {
					timeoutMs: this.gitCommandTimeoutMs,
					maxStdoutBytes: TRUSTED_GIT_LIMITS.diagnosticMaxBytes,
					maxStderrBytes: TRUSTED_GIT_LIMITS.diagnosticMaxBytes,
					killGraceMs: this.killGraceMs,
				});
				child = null;
				return { ...result, proc };
			};

			let pushResult = await pushOnce();

			// Revoke write phase immediately after process settles.
			let writeRevoked = true;
			try {
				await this.revokePhase();
			} catch {
				writeRevoked = false;
			}

			const finish = async (
				result: TrustedGitSafeResult,
			): Promise<TrustedGitSafeResult> => {
				const cleanup = await this.cleanupFinally({
					child,
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					markTerminal: true,
				});
				const revoked = cleanup.revoked && writeRevoked;
				if (!cleanup.cleaned || !writeRevoked) {
					return makeErrorResult({
						code: "cleanup_failed",
						publicationIdHash,
						executionEpoch: input.executionEpoch,
						revoked,
						destroyed: cleanup.destroyed,
						diagnostic: result.ok ? "cleanup after success" : result.diagnostic,
					});
				}
				if (result.ok) {
					return {
						...result,
						revoked: true,
						destroyed: true,
						capacityRetries,
					};
				}
				return {
					...result,
					revoked: true,
					destroyed: true,
				};
			};

			/** Fresh READ-phase exact-ref check. Write phase must already be revoked. */
			const reconcileOnce = async () => {
				const readGrant = buildPhaseGrant({
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					installationId: input.installationId,
					owner: input.owner,
					repo: input.repo,
					phase: "read",
					containerId: this.currentContainerId(),
				});
				await this.enablePhase(readGrant);
				const ls = await this.execHelper([
					"ls-remote-ref",
					input.owner,
					input.repo,
					input.ref,
				]);
				try {
					await this.revokePhase();
				} catch {
					writeRevoked = false;
				}
				const lsParsed = parseHelperLsRemote(parseJsonUnknown(ls.stdout));
				if (ls.timedOut || ls.overflow || ls.exitCode !== 0 || !lsParsed.ok) {
					return { action: "interrupted" as const, observed: null };
				}
				return reconcileWriteRef({
					observedSha: lsParsed.present ? lsParsed.sha : null,
					proposedSha: input.proposedSha,
					expectedOldSha: input.expectedOldSha,
				});
			};

			const pushParsed = parseHelperPush(parseJsonUnknown(pushResult.stdout), {
				ref: input.ref,
				tip: input.proposedSha,
			});

			// Direct success only on clean helper OK — never after timeout/overflow.
			const cleanPushSuccess =
				!pushResult.timedOut &&
				!pushResult.overflow &&
				pushResult.exitCode === 0 &&
				pushParsed.ok;

			if (cleanPushSuccess) {
				return await finish(
					makeSuccessResult({
						publicationIdHash,
						executionEpoch: input.executionEpoch,
						ref: input.ref,
						sha: input.proposedSha,
						revoked: true,
						destroyed: true,
						capacityRetries,
					}),
				);
			}

			// Every post-write-start uncertainty (timeout, overflow, invalid helper
			// output, nonzero exit, drain/throw recovered as failed push) reconciles.
			if (processStarted) {
				const decision = await reconcileOnce();

				if (decision.action === "success") {
					return await finish(
						makeSuccessResult({
							code: "reconciled",
							publicationIdHash,
							executionEpoch: input.executionEpoch,
							ref: input.ref,
							sha: decision.sha,
							revoked: true,
							destroyed: true,
							capacityRetries,
						}),
					);
				}

				if (decision.action === "retry") {
					// One retry only after observed exact old/absence.
					const retryGrant = buildPhaseGrant({
						publicationIdHash,
						executionEpoch: input.executionEpoch,
						installationId: input.installationId,
						owner: input.owner,
						repo: input.repo,
						phase: "write",
						containerId: this.currentContainerId(),
					});
					await this.enablePhase(retryGrant);
					pushResult = await pushOnce();
					try {
						await this.revokePhase();
					} catch {
						writeRevoked = false;
					}

					const retryParsed = parseHelperPush(
						parseJsonUnknown(pushResult.stdout),
						{ ref: input.ref, tip: input.proposedSha },
					);
					const retryClean =
						!pushResult.timedOut &&
						!pushResult.overflow &&
						pushResult.exitCode === 0 &&
						retryParsed.ok;

					if (retryClean) {
						return await finish(
							makeSuccessResult({
								publicationIdHash,
								executionEpoch: input.executionEpoch,
								ref: input.ref,
								sha: input.proposedSha,
								revoked: true,
								destroyed: true,
								capacityRetries,
							}),
						);
					}

					// Retry timeout/overflow/invalid/nonzero: re-reconcile once, no 2nd retry.
					const decision2 = await reconcileOnce();
					if (decision2.action === "success") {
						return await finish(
							makeSuccessResult({
								code: "reconciled",
								publicationIdHash,
								executionEpoch: input.executionEpoch,
								ref: input.ref,
								sha: decision2.sha,
								revoked: true,
								destroyed: true,
								capacityRetries,
							}),
						);
					}
					return await finish(
						makeErrorResult({
							code: "interrupted",
							publicationIdHash,
							executionEpoch: input.executionEpoch,
							revoked: true,
							destroyed: true,
							diagnostic: "retry exhausted",
						}),
					);
				}

				return await finish(
					makeErrorResult({
						code: "interrupted",
						publicationIdHash,
						executionEpoch: input.executionEpoch,
						revoked: true,
						destroyed: true,
						diagnostic: "third state",
					}),
				);
			}

			return await finish(
				makeErrorResult({
					code: "upstream",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked: true,
					destroyed: true,
					diagnostic:
						pushParsed.ok === false ? pushParsed.code : pushResult.stderr,
				}),
			);
		} catch (err) {
			const cleanup = await this.cleanupFinally({
				child,
				publicationIdHash: publicationIdHash || undefined,
				executionEpoch:
					typeof raw.executionEpoch === "number"
						? raw.executionEpoch
						: undefined,
				markTerminal: Boolean(publicationIdHash),
			});
			const code = err instanceof TrustedGitPolicyError ? err.code : "internal";
			return makeErrorResult({
				code,
				publicationIdHash: publicationIdHash || undefined,
				executionEpoch:
					typeof raw.executionEpoch === "number"
						? raw.executionEpoch
						: undefined,
				revoked: cleanup.revoked,
				destroyed: cleanup.destroyed,
				diagnostic: err instanceof Error ? err.message : "error",
			});
		}
	}

	// NOTE: Do NOT override alarm(). Base Container.alarm is required for
	// container DO lifecycle. Fail-safe uses schedule(failSafeCleanup).
}

// Re-export proxy for server entry.
export { ContainerProxy } from "@cloudflare/containers";
