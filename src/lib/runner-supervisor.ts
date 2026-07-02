import {
	type ExecutionSession,
	type LogEvent,
	parseSSEStream,
	type SessionOptions,
} from "@cloudflare/sandbox";
import {
	buildFifoWriteCommand,
	makeBrokerDir,
	makeProcessId,
	makeRunnerCommand,
	quoteShellArg,
} from "#/lib/runner-command";
import {
	type RunnerCommand,
	serializeRunnerCommand,
} from "#/lib/runner-protocol";
import { WORKSPACE_PATH } from "#/lib/workspace-policy";

const COMMAND_TIMEOUT_MS = 30_000;

export type RunnerProcessInfo = {
	processId: string;
	fifoPath: string;
};

type SandboxProcess = {
	id: string;
	status: string;
};

type SandboxWithRunnerSessions = {
	createSession(options?: SessionOptions): Promise<ExecutionSession>;
	getSession(sessionId: string): Promise<ExecutionSession>;
	listProcesses(): Promise<SandboxProcess[]>;
	streamProcessLogs(processId: string): Promise<ReadableStream>;
};

export type RunnerSandboxFactory = (
	env: Env,
	sandboxId: string,
) => SandboxWithRunnerSessions;

export type RunnerSupervisorOptions = {
	env: Env;
	getSandbox: RunnerSandboxFactory;
	onLogEvent: (event: LogEvent) => Promise<void>;
	onFailure: (error: Error) => Promise<void>;
};

function isSessionAlreadyExistsError(error: unknown): boolean {
	return (
		error instanceof Error &&
		/session ['"].+['"] already exists/i.test(error.message)
	);
}

async function createOrGetSandboxSession(
	sandbox: SandboxWithRunnerSessions,
	options: SessionOptions & { id: string },
): Promise<ExecutionSession> {
	try {
		return await sandbox.createSession(options);
	} catch (error) {
		if (!isSessionAlreadyExistsError(error)) {
			throw error;
		}

		return await sandbox.getSession(options.id);
	}
}

export class RunnerSupervisor {
	private commandQueue: Promise<void> = Promise.resolve();
	private streamStartedForProcessId: string | null = null;

	constructor(private readonly options: RunnerSupervisorOptions) {}

	async isAlive(processId: string, sandboxId?: string): Promise<boolean> {
		if (!sandboxId) return false;
		try {
			const sandbox = this.options.getSandbox(this.options.env, sandboxId);
			const processes = await sandbox.listProcesses();
			return processes.some(
				(process) => process.id === processId && process.status === "running",
			);
		} catch {
			return false;
		}
	}

	async start(input: {
		sessionId: string;
		sandboxId: string;
		modelSpecifier: string;
	}): Promise<RunnerProcessInfo> {
		const sandbox = this.options.getSandbox(this.options.env, input.sandboxId);
		const session = await createOrGetSandboxSession(sandbox, {
			id: input.sessionId,
			name: `Ditto ${input.sessionId}`,
			cwd: WORKSPACE_PATH,
			env: { OPENCODE_API_KEY: this.options.env.OPENCODE_API_KEY },
		});
		const brokerDir = makeBrokerDir(input.sessionId);
		const fifoPath = `${brokerDir}/runner.in`;
		const processId = makeProcessId(input.sessionId);
		const command = `bash -lc ${quoteShellArg(
			makeRunnerCommand({
				brokerDir,
				fifoPath,
				modelSpecifier: input.modelSpecifier,
			}),
		)}`;

		await session.startProcess(command, {
			processId,
			autoCleanup: false,
			cwd: WORKSPACE_PATH,
			env: { OPENCODE_API_KEY: this.options.env.OPENCODE_API_KEY },
			onExit: (code) => {
				if (code && code !== 0) {
					this.options
						.onFailure(new Error(`Runner exited with code ${code}.`))
						.catch(() => undefined);
				}
			},
		});

		await this.startLogStream(input.sandboxId, processId);
		return { processId, fifoPath };
	}

	async startLogStream(sandboxId: string, processId: string): Promise<void> {
		if (this.streamStartedForProcessId === processId) {
			return;
		}

		this.streamStartedForProcessId = processId;
		const sandbox = this.options.getSandbox(this.options.env, sandboxId);
		const stream = await sandbox.streamProcessLogs(processId);

		void (async () => {
			try {
				for await (const event of parseSSEStream<LogEvent>(stream)) {
					await this.options.onLogEvent(event);
				}
			} catch (error) {
				await this.options.onFailure(
					error instanceof Error
						? error
						: new Error("Runner log stream failed."),
				);
			}
		})();
	}

	async sendCommand(input: {
		sessionId: string;
		sandboxId: string;
		fifoPath: string;
		command: RunnerCommand;
	}): Promise<void> {
		const writePromise = this.commandQueue.then(async () => {
			const sandbox = this.options.getSandbox(
				this.options.env,
				input.sandboxId,
			);
			const session = await sandbox.getSession(input.sessionId);
			const result = await session.exec(
				buildFifoWriteCommand(
					input.fifoPath,
					serializeRunnerCommand(input.command),
				),
				{ cwd: WORKSPACE_PATH, timeout: COMMAND_TIMEOUT_MS },
			);

			if (!result.success) {
				throw new Error(
					trimCompact(result.stderr || result.stdout || "Runner write failed."),
				);
			}
		});
		this.commandQueue = writePromise.catch(() => undefined);
		await writePromise;
	}

	async readStderrTail(input: {
		sessionId: string;
		sandboxId: string;
	}): Promise<string> {
		const sandbox = this.options.getSandbox(this.options.env, input.sandboxId);
		const session = await sandbox.getSession(input.sessionId);
		const result = await session.exec(
			`tail -n 40 ${quoteShellArg(`${makeBrokerDir(input.sessionId)}/runner.err`)}`,
			{ cwd: WORKSPACE_PATH, timeout: 5_000 },
		);
		return trimCompact(result.stdout || result.stderr || "");
	}

	forgetLogStream(): void {
		this.streamStartedForProcessId = null;
	}
}

function trimCompact(value: string, maxLength = 2000): string {
	const compact = value.trim();

	if (compact.length <= maxLength) {
		return compact;
	}

	return `${compact.slice(0, maxLength)}\n...[truncated]`;
}
