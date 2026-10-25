import { getSandbox, Sandbox } from "@cloudflare/sandbox";
import type { ArtifactStore } from "./pi-durable-artifacts.ts";
import type {
	CheckpointHostPort,
	CheckpointRestorer,
} from "./pi-durable-checkpoints.ts";
import {
	composeCandidateExecution,
	type ExecutionSandbox,
} from "./pi-durable-execution.ts";
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
};

/** Candidate session with its own sandbox and recovery bucket; without both it is the base class. */
export class PiDurableExecutionSession extends PiDurableProductSession {
	declare env: ExecutionSessionBindings;
	private execution: ReturnType<typeof composeCandidateExecution> | undefined;
	/** The session's owned branch; Git actions stay unavailable until a seed handoff supplies it. */
	protected sessionBranch(): string | undefined {
		return undefined;
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
						sandbox: getSandbox(CandidateSandbox, scope.workspaceSessionId, {
							transport: "rpc",
						}) as ExecutionSandbox,
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
					})
				: undefined;
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
