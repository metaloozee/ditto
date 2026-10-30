import { getSandbox, Sandbox } from "@cloudflare/sandbox";
import {
	type ArchiveArtifactV1,
	parseArchiveArtifactV1,
} from "../../../packages/runtime-contracts/src/artifacts.js";
import { WORKSPACE_PREVIEW_PORT } from "../../../packages/runtime-contracts/src/workspace-action.js";
import type { ArtifactStore } from "./pi-durable-artifacts.ts";
import type {
	CheckpointHostPort,
	CheckpointRestorer,
} from "./pi-durable-checkpoints.ts";
import {
	composeCandidateExecution,
	type ExecutionSandbox,
} from "./pi-durable-execution.ts";
import type { PiDurableHost } from "./pi-durable-host.ts";
import { candidateSandboxName } from "./pi-durable-preview.ts";
import {
	type CandidatePrivateProduct,
	type CandidateRuntimeScope,
	type CandidateSessionBindings,
	PiDurableProductSession,
	parseCandidateRuntimeScope,
} from "./pi-durable-product-session.ts";
import type { RemoteExecutor } from "./pi-durable-tools.ts";
import type {
	WorkspaceController,
	WorkspaceHostPort,
} from "./pi-durable-workspace.ts";
import type { RuntimeKeyring } from "./runtime-crypto.ts";

/** Candidate execution sandbox: no direct egress; HTTPS goes to the product broker. */
export class PiDurableCandidateSandbox extends Sandbox {
	enableInternet = false;
	interceptHttps = true;
}

/** Outbound handler for sandbox traffic; `ctx.params` is the trusted scope set by this Worker. */
export async function candidateGit(
	request: Request,
	env: { CandidateProduct: CandidatePrivateProduct },
	ctx: { containerId: string; className: string; params: unknown },
): Promise<Response> {
	let scope: CandidateRuntimeScope;
	try {
		scope = parseCandidateRuntimeScope(ctx.params);
	} catch {
		return new Response("denied", { status: 403 });
	}
	return env.CandidateProduct.brokerCandidateGit(
		scope,
		request,
		ctx.containerId,
	);
}

// Class-field static outboundHandlers does not populate the SDK registry.
PiDurableCandidateSandbox.outboundHandlers = { candidateGit };

export type ExecutionSessionBindings = CandidateSessionBindings & {
	CandidateSandbox?: DurableObjectNamespace<PiDurableCandidateSandbox>;
	CANDIDATE_RECOVERY?: R2Bucket;
	/** Host for candidate preview URLs, such as `ayn.wtf` or `localhost:5173`; absent keeps preview unavailable. */
	CANDIDATE_PREVIEW_HOST?: string;
};

/** Candidate session with its own sandbox and recovery bucket; without both it is the base class. */
export class PiDurableExecutionSession extends PiDurableProductSession {
	declare env: ExecutionSessionBindings;
	private execution: ReturnType<typeof composeCandidateExecution> | undefined;
	private source: { branch: string; seed: ArchiveArtifactV1 } | undefined;
	private baselineAttempt: Promise<unknown> | undefined;
	/** The session's owned branch from the product record; none keeps Git actions unavailable. */
	protected sessionBranch(): string | undefined {
		return this.source?.branch;
	}
	protected override async loadExecutionSource(scope: CandidateRuntimeScope) {
		this.source = undefined;
		const { CandidateSandbox, CANDIDATE_RECOVERY } = this.env;
		if (!CandidateSandbox || !CANDIDATE_RECOVERY) return;
		try {
			const read =
				await this.env.CandidateProduct.readCandidateBaselineSource(scope);
			if ("denied" in read) return;
			if (typeof read.branch !== "string" || read.branch.length === 0) return;
			this.source = {
				branch: read.branch,
				seed: parseArchiveArtifactV1(read.seed),
			};
		} catch {
			this.source = undefined;
		}
	}
	protected override startBaseline(host: PiDurableHost) {
		const source = this.source;
		if (!this.execution || !source || this.baselineAttempt) return;
		// A failed publish records its own health; the next activation retries.
		const attempt = host
			.establishCandidateBaseline(source)
			.catch(() => undefined)
			.finally(() => {
				if (this.baselineAttempt === attempt) this.baselineAttempt = undefined;
			});
		this.baselineAttempt = attempt;
	}
	protected override prepareExecution(
		scope: CandidateRuntimeScope,
		keyring: RuntimeKeyring,
	) {
		const { CandidateSandbox, CANDIDATE_RECOVERY } = this.env;
		this.execution =
			CandidateSandbox && CANDIDATE_RECOVERY
				? composeCandidateExecution({
						storage: this.ctx.storage,
						binding: {
							ownerId: scope.userId,
							workspaceSessionId: scope.workspaceSessionId,
							keyring,
						},
						sandbox: getSandbox(
							CandidateSandbox,
							candidateSandboxName(scope.workspaceSessionId),
							{ transport: "rpc" },
						) as ExecutionSandbox,
						bucket: CANDIDATE_RECOVERY,
						outboundScope: scope,
						branchAuthority: {
							open: (request) =>
								this.env.CandidateProduct.openCandidateBranchFetch(
									scope,
									request,
								),
							close: (window) =>
								this.env.CandidateProduct.closeCandidateBranchFetch(
									scope,
									window,
								),
						},
						branch: this.sessionBranch(),
						now: Date.now,
						previewHostname: this.env.CANDIDATE_PREVIEW_HOST,
					})
				: undefined;
	}
	protected override async revokePreview(scope: CandidateRuntimeScope) {
		const { CandidateSandbox } = this.env;
		if (!CandidateSandbox) return;
		await (
			getSandbox(
				CandidateSandbox,
				candidateSandboxName(scope.workspaceSessionId),
				{ transport: "rpc" },
			) as ExecutionSandbox
		).unexposePort(WORKSPACE_PREVIEW_PORT);
	}
	protected override remoteExecutor(): RemoteExecutor | undefined {
		return this.execution?.executor;
	}
	protected override checkpointRestorer(
		port: CheckpointHostPort,
	): CheckpointRestorer | undefined {
		return this.execution?.restorer(port);
	}
	protected override workspaceController(
		port: WorkspaceHostPort,
	): WorkspaceController | undefined {
		return this.execution?.workspace(port);
	}
	protected override recoveryStore(): ArtifactStore | undefined {
		return this.execution?.store;
	}
}
