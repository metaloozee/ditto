import {
	type ArtifactExecution,
	type ArtifactPermit,
	type ArtifactSandbox,
	ArtifactStepRejected,
	CLOSED_GIT,
	r2ArtifactStore,
	sandboxArtifactExecution,
} from "./pi-durable-artifacts.ts";
import {
	type CheckpointHostPort,
	createCheckpointPublisher,
} from "./pi-durable-checkpoints.ts";
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
};

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

/** UI Git through the image-owned `ditto-workspace`; preview is not composed. */
export function sandboxWorkspaceExecution(
	sandbox: ExecutionSandbox,
	now: () => number,
): WorkspaceExecution {
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
		async previewStart() {
			throw previewDenied();
		},
		async previewStop() {
			throw previewDenied();
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
	/** Absent until the session's owned branch is known; Git actions stay unavailable. */
	branch: string | undefined;
	now(): number;
}) {
	const store = r2ArtifactStore(deps.bucket);
	let execution: ArtifactExecution | undefined;
	const artifacts = () =>
		(execution ??= sandboxArtifactExecution(
			sandboxStreams(deps.sandbox),
			deps.now,
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
				execution: sandboxWorkspaceExecution(deps.sandbox, deps.now),
				publisher: () => backups,
				branch,
				now: deps.now,
			});
			return controller;
		},
	};
}
