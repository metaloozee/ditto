export const SESSION_RUNTIME_PROTOCOL_VERSION = 1;
export const SESSION_RUNTIME_CALL_TIMEOUT_MS = 5_000;

export type SessionRuntimeModelConfiguration = {
	configured: boolean;
	protocolVersion: number;
};

export type SessionRuntimeDeliverInput = {
	commandId: string;
	ownerVersion: number;
};

export type SessionRuntimeControlInput = {
	commandId: string;
	ownerVersion: number;
};

export type SessionRuntime = {
	modelConfiguration(): Promise<SessionRuntimeModelConfiguration>;
	deliver(input: SessionRuntimeDeliverInput): Promise<void>;
	control(input: SessionRuntimeControlInput): Promise<void>;
};

export function createSessionRuntimeClient(
	transport: SessionRuntime,
	options?: { timeoutMs?: number },
): SessionRuntime {
	const timeoutMs = options?.timeoutMs ?? SESSION_RUNTIME_CALL_TIMEOUT_MS;
	const withTimeout = async <T>(operation: () => Promise<T>): Promise<T> => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				operation(),
				new Promise<T>((_, reject) => {
					timer = setTimeout(() => {
						reject(new Error("runtime_timeout"));
					}, timeoutMs);
				}),
			]);
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	};
	return {
		modelConfiguration: () => withTimeout(() => transport.modelConfiguration()),
		deliver: (input) => withTimeout(() => transport.deliver(input)),
		control: (input) => withTimeout(() => transport.control(input)),
	};
}
