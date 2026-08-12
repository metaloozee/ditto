/**
 * Trusted Git Executor — ephemeral Container-backed Durable Object.
 *
 * Narrow RPC only. No project code, no generic shell/process API, no
 * production caller wiring. Credentials stay in the Worker outbound handler.
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
	reconcileWriteRef,
	TRUSTED_GIT_GITHUB_HOST,
	TRUSTED_GIT_LIMITS,
	TrustedGitPolicyError,
	type TrustedGitSafeResult,
	validateProbeInput,
	validatePushInput,
} from "#/lib/trusted-git-executor-policy";

/** Narrow env: never full Env; never the project container binding. */
export type TrustedGitExecutorEnv = GitHubAppEnv & {
	BACKUP_BUCKET: R2Bucket;
};

type HelperJson = {
	ok: boolean;
	code: string;
	message?: string;
	sha?: string | null;
	present?: boolean;
	tip?: string;
	ref?: string;
	exitCode?: number;
};

type TerminalState = {
	terminal: true;
	publicationIdHash: string;
	executionEpoch: number;
};

const HELPER = "/usr/local/bin/ditto-git-executor";
const STATE_KEY_TERMINAL = "trusted-git-terminal";
const STATE_KEY_OP = "trusted-git-op-lock";

function asGitHubEnv(env: TrustedGitExecutorEnv): GitHubAppEnv {
	return {
		GITHUB_APP_ID: env.GITHUB_APP_ID,
		GITHUB_APP_PRIVATE_KEY: env.GITHUB_APP_PRIVATE_KEY,
	};
}

async function readHelperJson(
	stream: ReadableStream<Uint8Array> | null,
	maxBytes: number,
): Promise<{ text: string; json: HelperJson | null }> {
	if (!stream) {
		return { text: "", json: null };
	}
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			break;
		}
		chunks.push(value);
	}
	const merged = new Uint8Array(total > maxBytes ? maxBytes : total);
	let offset = 0;
	for (const c of chunks) {
		const slice =
			c.byteLength > merged.byteLength - offset
				? c.subarray(0, merged.byteLength - offset)
				: c;
		merged.set(slice, offset);
		offset += slice.byteLength;
		if (offset >= merged.byteLength) break;
	}
	const text = new TextDecoder().decode(merged);
	try {
		return { text, json: JSON.parse(text) as HelperJson };
	} catch {
		return { text, json: null };
	}
}

async function drainBounded(
	stream: ReadableStream<Uint8Array> | null,
	maxBytes: number,
): Promise<string> {
	const { text } = await readHelperJson(stream, maxBytes);
	return text;
}

export class TrustedGitExecutor extends Container<TrustedGitExecutorEnv> {
	// No defaultPort — no listening public/container port.
	sleepAfter = "2m";
	enableInternet = false;
	interceptHttps = true;
	envVars: Record<string, string> = {
		// Credential-free, minimal.
		LANG: "C",
		LC_ALL: "C",
	};
	entrypoint = [HELPER, "hold"];

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
				const classified = classifySmartHttpRequest(request, params);
				const permission = contentsPermissionForPhase(params.phase);
				const token = await getInstallationAccessToken(
					asGitHubEnv(env),
					params.installationId,
					{
						repositories: [params.repo],
						contents: permission,
					},
				);

				let revoked = false;
				const finalize = async () => {
					if (revoked) return;
					revoked = true;
					await revokeInstallationAccessToken(token);
				};

				const upstreamReq = buildUpstreamGitRequest(request, classified, token);
				let upstream: Response;
				try {
					upstream = await fetch(upstreamReq);
				} catch {
					await finalize();
					return new Response("upstream failed", { status: 502 });
				}

				if (isRedirectStatus(upstream.status)) {
					await finalize();
					return new Response("redirect denied", { status: 502 });
				}

				const body = upstream.body
					? boundReadableStream(
							upstream.body,
							TRUSTED_GIT_LIMITS.httpBodyMaxBytes,
							finalize,
						)
					: null;

				if (!body) {
					await finalize();
				}

				// Forward a minimal safe response header set.
				const headers = new Headers();
				const ctype = upstream.headers.get("content-type");
				if (ctype) headers.set("content-type", ctype);
				const cache = upstream.headers.get("cache-control");
				if (cache) headers.set("cache-control", cache);

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

	private async markTerminal(
		publicationIdHash: string,
		executionEpoch: number,
	) {
		const state: TerminalState = {
			terminal: true,
			publicationIdHash,
			executionEpoch,
		};
		await this.ctx.storage.put(STATE_KEY_TERMINAL, state);
	}

	private async isTerminal(): Promise<TerminalState | null> {
		return (
			(await this.ctx.storage.get<TerminalState>(STATE_KEY_TERMINAL)) ?? null
		);
	}

	private async ensureContainerStarted(): Promise<void> {
		// start() without waiting for ports — no defaultPort.
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

	private async revokePhase(): Promise<void> {
		try {
			await this.removeOutboundByHost(TRUSTED_GIT_GITHUB_HOST);
		} catch {
			// Best-effort; cleanup path still destroys container.
		}
		// Restore static deny as catch-all (already static outbound).
		try {
			await this.setOutboundHandler("denyAll");
		} catch {
			// ignore
		}
	}

	private async destroyAndProve(): Promise<boolean> {
		try {
			if (this.ctx.container?.running) {
				await this.ctx.container.destroy();
			} else {
				// Still attempt destroy for DO-managed lifecycle.
				try {
					await this.ctx.container?.destroy();
				} catch {
					// ignore
				}
			}
			// Prove not running when API available.
			if (this.ctx.container && this.ctx.container.running) {
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
		json: HelperJson | null;
		started: boolean;
	}> {
		const timeoutMs =
			options?.timeoutMs ?? TRUSTED_GIT_LIMITS.gitCommandTimeoutMs;
		const container = this.ctx.container;
		if (!container) {
			throw new TrustedGitPolicyError("internal", "no container");
		}

		const proc = await container.exec([HELPER, ...argv], {
			stdin: options?.stdin ?? "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		// Process start occurred as soon as exec returns a handle.
		const started = true;

		if (options?.stdin && proc.stdin) {
			// stdin already provided via options; no manual pipe needed when stream passed.
		} else if (proc.stdin) {
			await proc.stdin.close();
		}

		const ac = new AbortController();
		const timer = setTimeout(() => {
			try {
				proc.kill();
			} catch {
				// ignore
			}
			ac.abort();
		}, timeoutMs);

		try {
			const [stdout, stderr, exitCode] = await Promise.all([
				drainBounded(proc.stdout, TRUSTED_GIT_LIMITS.diagnosticMaxBytes),
				drainBounded(proc.stderr, TRUSTED_GIT_LIMITS.diagnosticMaxBytes),
				proc.exitCode,
			]);
			let json: HelperJson | null = null;
			try {
				json = JSON.parse(stdout) as HelperJson;
			} catch {
				json = null;
			}
			return { exitCode, stdout, stderr, json, started };
		} finally {
			clearTimeout(timer);
		}
	}

	private async cleanupFinally(options: {
		child?: { kill: (signal?: number) => void } | null;
		publicationIdHash?: string;
		executionEpoch?: number;
		markTerminal?: boolean;
	}): Promise<{ revoked: boolean; destroyed: boolean }> {
		let revoked = true;
		try {
			await this.revokePhase();
		} catch {
			revoked = false;
		}
		try {
			options.child?.kill();
		} catch {
			// ignore
		}
		const destroyed = await this.destroyAndProve();
		try {
			await this.ctx.storage.delete(STATE_KEY_OP);
		} catch {
			// ignore
		}
		if (
			options.markTerminal &&
			options.publicationIdHash &&
			options.executionEpoch
		) {
			await this.markTerminal(
				options.publicationIdHash,
				options.executionEpoch,
			);
		}
		// Clear any non-secret phase leftovers already handled by revokePhase.
		return { revoked, destroyed };
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
		let revoked = false;
		let destroyed = false;
		try {
			const input = validateProbeInput(raw);
			publicationIdHash = await deriveExecutorIdentity(
				input.publicationId,
				input.executionEpoch,
			);

			const terminal = await this.isTerminal();
			if (terminal) {
				return makeErrorResult({
					code: "terminal_reuse",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked: true,
					destroyed: true,
				});
			}

			// Fail-safe alarm
			await this.ctx.storage.setAlarm(
				Date.now() + TRUSTED_GIT_LIMITS.phaseGrantMaxMs,
			);

			await this.ensureContainerStarted();

			const grant = buildPhaseGrant({
				publicationIdHash,
				executionEpoch: input.executionEpoch,
				installationId: input.installationId,
				owner: input.owner,
				repo: input.repo,
				phase: "read",
			});
			await this.enablePhase(grant);

			const result = await this.execHelper([
				"ls-remote-ref",
				input.owner,
				input.repo,
				input.ref,
			]);

			const cleanup = await this.cleanupFinally({
				publicationIdHash,
				executionEpoch: input.executionEpoch,
				markTerminal: true,
			});
			revoked = cleanup.revoked;
			destroyed = cleanup.destroyed;

			if (!cleanup.destroyed || !cleanup.revoked) {
				return makeErrorResult({
					code: "cleanup_failed",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked,
					destroyed,
					diagnostic: result.stderr || result.stdout,
				});
			}

			if (result.exitCode !== 0 || !result.json?.ok) {
				return makeErrorResult({
					code: "upstream",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked,
					destroyed,
					diagnostic: result.json?.code ?? result.stderr,
				});
			}

			const present = result.json.present === true;
			const sha =
				present && typeof result.json.sha === "string" ? result.json.sha : null;

			return makeSuccessResult({
				publicationIdHash,
				executionEpoch: input.executionEpoch,
				ref: input.ref,
				sha,
				present,
				revoked,
				destroyed,
			});
		} catch (err) {
			const cleanup = await this.cleanupFinally({
				publicationIdHash: publicationIdHash || undefined,
				executionEpoch:
					typeof raw.executionEpoch === "number"
						? raw.executionEpoch
						: undefined,
				markTerminal: Boolean(publicationIdHash),
			});
			revoked = cleanup.revoked;
			destroyed = cleanup.destroyed;
			const code = err instanceof TrustedGitPolicyError ? err.code : "internal";
			return makeErrorResult({
				code,
				publicationIdHash: publicationIdHash || undefined,
				executionEpoch:
					typeof raw.executionEpoch === "number"
						? raw.executionEpoch
						: undefined,
				revoked,
				destroyed,
				diagnostic: err instanceof Error ? err.message : "error",
			});
		} finally {
			try {
				await this.ctx.storage.deleteAlarm();
			} catch {
				// ignore
			}
		}
	}

	/**
	 * Validate a bounded R2 bundle in a fresh quarantine, then non-force push
	 * the exact ref. Order is load-bearing (validate before write phase).
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
				return makeErrorResult({
					code: "terminal_reuse",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked: true,
					destroyed: true,
				});
			}

			const existingOp = await this.ctx.storage.get(STATE_KEY_OP);
			if (existingOp) {
				return makeErrorResult({
					code: "terminal_reuse",
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					revoked: true,
					destroyed: true,
				});
			}
			await this.ctx.storage.put(STATE_KEY_OP, {
				publicationIdHash,
				executionEpoch: input.executionEpoch,
			});
			await this.ctx.storage.setAlarm(
				Date.now() + TRUSTED_GIT_LIMITS.phaseGrantMaxMs,
			);

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

			// Stream R2 body through counting transform into helper stdin.
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
			// Validation process start is not a write process.
			const validateStdout = await drainBounded(
				validateProc.stdout,
				TRUSTED_GIT_LIMITS.diagnosticMaxBytes,
			);
			const validateStderr = await drainBounded(
				validateProc.stderr,
				TRUSTED_GIT_LIMITS.diagnosticMaxBytes,
			);
			const validateCode = await validateProc.exitCode;
			let validateJson: HelperJson | null = null;
			try {
				validateJson = JSON.parse(validateStdout) as HelperJson;
			} catch {
				validateJson = null;
			}

			if (validateCode !== 0 || !validateJson?.ok) {
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
					diagnostic: validateJson?.code ?? validateStderr,
				});
			}
			// When the runtime consumed the stdin stream, counted tracks bytes.
			// If the binding drained without pull observability, R2 size + helper
			// digest remain authoritative (already checked above / inside helper).
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

			// Enable write phase only after successful validation.
			const writeGrant = buildPhaseGrant({
				publicationIdHash,
				executionEpoch: input.executionEpoch,
				installationId: input.installationId,
				owner: input.owner,
				repo: input.repo,
				phase: "write",
			});
			await this.enablePhase(writeGrant);

			const pushArgv = [
				"push-validated",
				input.owner,
				input.repo,
				input.ref,
				input.proposedSha,
			];

			const pushOnce = async (): Promise<{
				exitCode: number;
				stdout: string;
				stderr: string;
				json: HelperJson | null;
			}> => {
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
				const timeoutMs = TRUSTED_GIT_LIMITS.gitCommandTimeoutMs;
				const timer = setTimeout(() => {
					try {
						proc.kill();
					} catch {
						// ignore
					}
				}, timeoutMs);
				try {
					const stdout = await drainBounded(
						proc.stdout,
						TRUSTED_GIT_LIMITS.diagnosticMaxBytes,
					);
					const stderr = await drainBounded(
						proc.stderr,
						TRUSTED_GIT_LIMITS.diagnosticMaxBytes,
					);
					const exitCode = await proc.exitCode;
					let json: HelperJson | null = null;
					try {
						json = JSON.parse(stdout) as HelperJson;
					} catch {
						json = null;
					}
					return { exitCode, stdout, stderr, json };
				} finally {
					clearTimeout(timer);
					child = null;
				}
			};

			let pushResult = await pushOnce();

			// Revoke write phase immediately after process settles.
			await this.revokePhase();

			const finish = async (
				result: TrustedGitSafeResult,
			): Promise<TrustedGitSafeResult> => {
				const cleanup = await this.cleanupFinally({
					child,
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					markTerminal: true,
				});
				if (!cleanup.destroyed || !cleanup.revoked) {
					return makeErrorResult({
						code: "cleanup_failed",
						publicationIdHash,
						executionEpoch: input.executionEpoch,
						revoked: cleanup.revoked,
						destroyed: cleanup.destroyed,
						diagnostic: result.ok ? "cleanup after success" : result.diagnostic,
					});
				}
				// Overlay cleanup flags onto success.
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

			if (pushResult.exitCode === 0 && pushResult.json?.ok) {
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

			// Post-start uncertainty: reconcile via fresh read phase.
			if (processStarted) {
				const readGrant = buildPhaseGrant({
					publicationIdHash,
					executionEpoch: input.executionEpoch,
					installationId: input.installationId,
					owner: input.owner,
					repo: input.repo,
					phase: "read",
				});
				await this.enablePhase(readGrant);
				const ls = await this.execHelper([
					"ls-remote-ref",
					input.owner,
					input.repo,
					input.ref,
				]);
				await this.revokePhase();

				const observed =
					ls.json?.ok &&
					ls.json.present === true &&
					typeof ls.json.sha === "string"
						? ls.json.sha
						: ls.json?.ok && ls.json.present === false
							? null
							: null;
				// If ls-remote failed hard, treat as interrupted third state with unknown.
				const decision =
					ls.exitCode === 0 && ls.json?.ok
						? reconcileWriteRef({
								observedSha: observed,
								proposedSha: input.proposedSha,
								expectedOldSha: input.expectedOldSha,
							})
						: ({ action: "interrupted", observed: null } as const);

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
					// At most one retry after exact-old reconciliation.
					const retryGrant = buildPhaseGrant({
						publicationIdHash,
						executionEpoch: input.executionEpoch,
						installationId: input.installationId,
						owner: input.owner,
						repo: input.repo,
						phase: "write",
					});
					await this.enablePhase(retryGrant);
					pushResult = await pushOnce();
					await this.revokePhase();

					if (pushResult.exitCode === 0 && pushResult.json?.ok) {
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

					// Re-reconcile once more; no second retry.
					const readGrant2 = buildPhaseGrant({
						publicationIdHash,
						executionEpoch: input.executionEpoch,
						installationId: input.installationId,
						owner: input.owner,
						repo: input.repo,
						phase: "read",
					});
					await this.enablePhase(readGrant2);
					const ls2 = await this.execHelper([
						"ls-remote-ref",
						input.owner,
						input.repo,
						input.ref,
					]);
					await this.revokePhase();
					const observed2 =
						ls2.json?.ok &&
						ls2.json.present === true &&
						typeof ls2.json.sha === "string"
							? ls2.json.sha
							: null;
					if (observed2 === input.proposedSha) {
						return await finish(
							makeSuccessResult({
								code: "reconciled",
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
					diagnostic: pushResult.json?.code ?? pushResult.stderr,
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
		} finally {
			try {
				await this.ctx.storage.deleteAlarm();
			} catch {
				// ignore
			}
		}
	}

	/** Alarm fail-safe: revoke phase and destroy if the DO is interrupted. */
	async alarm(): Promise<void> {
		try {
			await this.revokePhase();
		} catch {
			// ignore
		}
		try {
			await this.destroyAndProve();
		} catch {
			// ignore
		}
		try {
			await this.ctx.storage.delete(STATE_KEY_OP);
		} catch {
			// ignore
		}
	}
}

// Re-export proxy for server entry.
export { ContainerProxy } from "@cloudflare/containers";
