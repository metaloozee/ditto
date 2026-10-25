import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
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
	type CandidateRuntimeScope,
	type CandidateSessionBindings,
	PiDurableProductSession,
} from "./pi-durable-product-session.ts";
import type { RemoteExecutor } from "./pi-durable-tools.ts";
import type {
	WorkspaceController,
	WorkspaceHostPort,
} from "./pi-durable-workspace.ts";
import type { RuntimeKeyring } from "./runtime-crypto.ts";

export type ExecutionSessionBindings = CandidateSessionBindings & {
	CandidateSandbox?: DurableObjectNamespace<Sandbox>;
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
