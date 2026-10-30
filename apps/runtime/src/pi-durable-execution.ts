import { WORKSPACE_PREVIEW_PORT } from "../../../packages/runtime-contracts/src/workspace-action.js";
import {
	type ArtifactExecution,
	type ArtifactPermit,
	type ArtifactSandbox,
	ArtifactStepRejected,
	type BranchSyncAuthority,
	CLOSED_GIT,
	r2ArtifactStore,
	sandboxArtifactExecution,
} from "./pi-durable-artifacts.ts";
import {
	type CheckpointHostPort,
	createCheckpointPublisher,
} from "./pi-durable-checkpoints.ts";
import { newPreviewToken, previewToken } from "./pi-durable-preview.ts";
import { sandboxExecutor } from "./pi-durable-tools.ts";
import {
	createWorkspaceController,
	type WorkspaceController,
	type WorkspaceExecution,
	type WorkspaceHostPort,
} from "./pi-durable-workspace.ts";
import type { RuntimeKeyring } from "./runtime-crypto.ts";

/** The slice of an rpc-transport Cloudflare Sandbox that execution needs. */
export type ExecutionSandbox = {
	exec(
		command: string,
		options?: {
			timeout?: number;
			signal?: AbortSignal;
			env?: Record<string, string>;
		},
	): Promise<{ exitCode: number; stdout: string }>;
	readFile(
		path: string,
		options: { encoding: "none" },
	): Promise<{ content: unknown }>;
	writeFile(
		path: string,
		content: string | ReadableStream<Uint8Array>,
	): Promise<unknown>;
	setOutboundHandler(name: string, params: unknown): Promise<unknown>;
	startProcess(
		command: string,
		options: {
			processId: string;
			cwd: string;
			env: Record<string, string>;
			autoCleanup: boolean;
		},
	): Promise<unknown>;
	getProcess(id: string): Promise<{ status: string } | null>;
	killProcess(id: string): Promise<unknown>;
	exposePort(
		port: number,
		options: { hostname: string; token: string },
	): Promise<{ url: string }>;
	unexposePort(port: number): Promise<unknown>;
	getExposedPorts(hostname: string): Promise<{ url: string; port: number }[]>;
};

const PREVIEW_PROCESS_ID = "ditto-preview";
const READY_MAX_MS = 30_000;
const STOP_EVIDENCE_MS = 10_000;
const STOP_POLL_MS = 250;
const HEALTHY = new Set(["starting", "running"]);

const MESSAGE_PATH = "/tmp/ditto-workspace-commit-message.txt";
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** Binary file transfer over the rpc transport; raw bytes, no SSE framing. */
export function sandboxStreams(sandbox: ExecutionSandbox): ArtifactSandbox {
	return {
		exec: (command, options) => sandbox.exec(command, options),
		async readStream(path) {
			const { content } = await sandbox.readFile(path, { encoding: "none" });
			if (!(content instanceof ReadableStream))
				throw new ArtifactStepRejected(
					"execution_failed",
					"Sandbox readFile did not return a binary stream",
				);
			return content as ReadableStream<Uint8Array>;
		},
		async writeStream(path, body) {
			await sandbox.writeFile(path, body);
		},
	};
}

function parseWorkspaceCli(stdout: string): Record<string, unknown> {
	const line = stdout.trim().split("\n").at(-1);
	let value: unknown;
	try {
		value = JSON.parse(line ?? "");
	} catch {
		throw new ArtifactStepRejected(
			"execution_failed",
			"Workspace command returned no result",
		);
	}
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new ArtifactStepRejected(
			"execution_failed",
			"Workspace command returned no result",
		);
	const record = value as Record<string, unknown>;
	if (record.ok === false) {
		const code = typeof record.error === "string" ? record.error : "failed";
		throw new ArtifactStepRejected(
			code === "secret_path" ? "verification_failed" : "execution_failed",
			`Workspace command failed (${code})`,
		);
	}
	if (record.ok !== true)
		throw new ArtifactStepRejected(
			"execution_failed",
			"Workspace command returned an invalid result",
		);
	return record;
}

/** UI Git and preview through the image-owned `ditto-workspace`; preview needs a configured hostname. */
export function sandboxWorkspaceExecution(
	sandbox: ExecutionSandbox,
	now: () => number,
	preview: { hostname?: string; sleep?(ms: number): Promise<void> } = {},
): WorkspaceExecution {
	const previewHostname = preview.hostname;
	const sleep =
		preview.sleep ??
		((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const timeout = (permit: ArtifactPermit) =>
		Math.max(1, permit.deadlineAt - now());
	const previewDenied = () =>
		new ArtifactStepRejected(
			"authority_denied",
			"Preview is not composed for this session",
			true,
		);
	return {
		async present(permit) {
			const result = await sandbox.exec(
				`${CLOSED_GIT} rev-parse --is-inside-work-tree`,
				{ timeout: timeout(permit) },
			);
			return result.exitCode === 0;
		},
		async gitStatus(permit, request) {
			const result = await sandbox.exec(
				`ditto-workspace status --branch ${quote(request.branch)}`,
				{ timeout: timeout(permit) },
			);
			const { branch, head, changed } = parseWorkspaceCli(result.stdout);
			if (
				typeof branch !== "string" ||
				typeof head !== "string" ||
				typeof changed !== "number" ||
				!Number.isSafeInteger(changed) ||
				changed < 0
			)
				throw new ArtifactStepRejected(
					"execution_failed",
					"Workspace status returned an invalid result",
				);
			return { branch, head, changed };
		},
		async gitCommit(permit, request) {
			await sandbox.writeFile(MESSAGE_PATH, request.message);
			try {
				const result = await sandbox.exec(
					`ditto-workspace commit --branch ${quote(request.branch)} --message-file ${MESSAGE_PATH}`,
					{ timeout: timeout(permit) },
				);
				const { committed, head } = parseWorkspaceCli(result.stdout);
				if (typeof committed !== "boolean" || typeof head !== "string")
					throw new ArtifactStepRejected(
						"execution_failed",
						"Workspace commit returned an invalid result",
					);
				return { committed, head };
			} finally {
				await sandbox
					.exec(`rm -f -- ${MESSAGE_PATH}`, { timeout: timeout(permit) })
					.catch(() => undefined);
			}
		},
		async previewStart(permit, { port }) {
			if (!previewHostname) throw previewDenied();
			await sandbox.unexposePort(port);
			await sandbox.killProcess(PREVIEW_PROCESS_ID).catch(() => undefined);
			const found = parseWorkspaceCli(
				(
					await sandbox.exec("ditto-workspace preview command", {
						timeout: timeout(permit),
					})
				).stdout,
			);
			const { command, cwd, env } = found;
			if (
				typeof command !== "string" ||
				command === "" ||
				typeof cwd !== "string" ||
				!env ||
				typeof env !== "object" ||
				Array.isArray(env) ||
				!Object.values(env).every((value) => typeof value === "string")
			)
				throw new ArtifactStepRejected(
					"execution_failed",
					"Preview command returned an invalid result",
				);
			await sandbox.startProcess(command, {
				processId: PREVIEW_PROCESS_ID,
				cwd,
				env: env as Record<string, string>,
				autoCleanup: true,
			});
			try {
				const wait = Math.max(
					1,
					Math.min(READY_MAX_MS, permit.deadlineAt - now()),
				);
				parseWorkspaceCli(
					(
						await sandbox.exec(
							`ditto-workspace preview ready --timeout-ms ${wait}`,
							{
								timeout: timeout(permit),
							},
						)
					).stdout,
				);
				const process = await sandbox.getProcess(PREVIEW_PROCESS_ID);
				if (!process || !HEALTHY.has(process.status))
					throw new ArtifactStepRejected(
						"execution_failed",
						"Preview process is not running",
					);
				const token = newPreviewToken();
				const { url } = await sandbox.exposePort(port, {
					hostname: previewHostname,
					token,
				});
				if (previewToken(url) !== token)
					throw new ArtifactStepRejected(
						"execution_failed",
						"Preview URL is malformed",
					);
				return { url };
			} catch (error) {
				await sandbox.unexposePort(port);
				await sandbox.killProcess(PREVIEW_PROCESS_ID).catch(() => undefined);
				throw error;
			}
		},
		async previewStop(permit) {
			try {
				await sandbox.unexposePort(WORKSPACE_PREVIEW_PORT);
			} catch {
				throw new ArtifactStepRejected(
					"execution_failed",
					"Preview revocation failed",
				);
			}
			await sandbox.killProcess(PREVIEW_PROCESS_ID).catch(() => undefined);
			const bound = Math.min(STOP_EVIDENCE_MS, permit.deadlineAt - now());
			let waited = 0;
			const started = now();
			for (;;) {
				let process: { status: string } | null;
				try {
					process = await sandbox.getProcess(PREVIEW_PROCESS_ID);
				} catch {
					return { terminated: false };
				}
				if (!process || !HEALTHY.has(process.status))
					return { terminated: true };
				if (waited >= bound || now() - started >= bound)
					return { terminated: false };
				await sleep(STOP_POLL_MS);
				waited += STOP_POLL_MS;
			}
		},
		async previewUrl() {
			if (!previewHostname) return undefined;
			return (await sandbox.getExposedPorts(previewHostname)).find(
				(p) => p.port === WORKSPACE_PREVIEW_PORT,
			)?.url;
		},
	};
}

/** One session's executor, paired restore, Git controller and recovery store. */
export function composeCandidateExecution(deps: {
	storage: Parameters<typeof createCheckpointPublisher>[0]["storage"];
	binding: {
		ownerId: string;
		workspaceSessionId: string;
		keyring: RuntimeKeyring;
	};
	sandbox: ExecutionSandbox;
	bucket: R2Bucket;
	/** Product-backed authority for the baseline branch fetch. */
	branchAuthority: BranchSyncAuthority;
	/** Trusted params the sandbox's outbound Git handler receives with each request. */
	outboundScope: unknown;
	/** Absent until the session's owned branch is known; Git actions stay unavailable. */
	branch: string | undefined;
	now(): number;
	/** Host the SDK builds preview URLs under; absent keeps preview unavailable. */
	previewHostname?: string;
	/** Test seam for the stop-evidence poll. */
	sleep?(ms: number): Promise<void>;
}) {
	const store = r2ArtifactStore(deps.bucket);
	let execution: ArtifactExecution | undefined;
	const artifacts = () =>
		(execution ??= sandboxArtifactExecution(
			sandboxStreams(deps.sandbox),
			deps.now,
			{
				beforeFetch: async () => {
					await deps.sandbox.setOutboundHandler(
						"candidateGit",
						deps.outboundScope,
					);
				},
			},
		));
	let controller: WorkspaceController | undefined;
	const writers = async () =>
		controller ? controller.writers() : { settled: true };
	const publisher = (host: CheckpointHostPort) =>
		createCheckpointPublisher({
			storage: deps.storage,
			host,
			binding: deps.binding,
			execution: artifacts(),
			branch: deps.branchAuthority,
			store,
			writers,
			now: deps.now,
		});
	return {
		executor: sandboxExecutor(deps.sandbox, {
			workspaceSessionId: deps.binding.workspaceSessionId,
		}),
		store,
		restorer: (port: CheckpointHostPort) => publisher(port),
		workspace(port: WorkspaceHostPort): WorkspaceController | undefined {
			const branch = deps.branch;
			if (branch === undefined) return undefined;
			const backups = publisher(port);
			controller = createWorkspaceController({
				storage: deps.storage,
				host: port,
				execution: sandboxWorkspaceExecution(deps.sandbox, deps.now, {
					hostname: deps.previewHostname,
					sleep: deps.sleep,
				}),
				publisher: () => backups,
				branch,
				now: deps.now,
			});
			return controller;
		},
	};
}
