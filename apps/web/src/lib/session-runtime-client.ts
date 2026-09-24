import { AsyncLocalStorage } from "node:async_hooks";

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

export type SessionRuntimeHandoffAck = {
	version: 1;
	commandId: string;
	ownerVersion: number;
	acceptedPosition: number;
	receiptId: string;
};

export type SessionRuntime = {
	modelConfiguration(): Promise<SessionRuntimeModelConfiguration>;
	deliver(input: SessionRuntimeDeliverInput): Promise<SessionRuntimeHandoffAck>;
	control(input: SessionRuntimeControlInput): Promise<SessionRuntimeHandoffAck>;
};

export class SessionRuntimeHandoffError extends Error {
	constructor(
		readonly code:
			| "missing_predecessor"
			| "runtime_unavailable"
			| "runtime_timeout"
			| "invalid_ack",
		message: string,
	) {
		super(message);
		this.name = "SessionRuntimeHandoffError";
	}
}

export function createUnavailableSessionRuntime(): SessionRuntime {
	return {
		async modelConfiguration() {
			return {
				configured: false,
				protocolVersion: SESSION_RUNTIME_PROTOCOL_VERSION,
			};
		},
		async deliver() {
			throw new SessionRuntimeHandoffError(
				"runtime_unavailable",
				"runtime_unavailable",
			);
		},
		async control() {
			throw new SessionRuntimeHandoffError(
				"runtime_unavailable",
				"runtime_unavailable",
			);
		},
	};
}

export function parseSessionRuntimeHandoffAck(
	value: unknown,
): SessionRuntimeHandoffAck {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new SessionRuntimeHandoffError(
			"invalid_ack",
			"Handoff acknowledgment must be an object.",
		);
	}
	const record = value as Record<string, unknown>;
	if (record.version !== 1) {
		throw new SessionRuntimeHandoffError(
			"invalid_ack",
			"Handoff acknowledgment version is unsupported.",
		);
	}
	if (typeof record.commandId !== "string" || record.commandId.length === 0) {
		throw new SessionRuntimeHandoffError(
			"invalid_ack",
			"Handoff acknowledgment commandId is invalid.",
		);
	}
	if (
		!Number.isSafeInteger(record.ownerVersion) ||
		(record.ownerVersion as number) < 1
	) {
		throw new SessionRuntimeHandoffError(
			"invalid_ack",
			"Handoff acknowledgment ownerVersion is invalid.",
		);
	}
	if (
		!Number.isSafeInteger(record.acceptedPosition) ||
		(record.acceptedPosition as number) < 1
	) {
		throw new SessionRuntimeHandoffError(
			"invalid_ack",
			"Handoff acknowledgment acceptedPosition is invalid.",
		);
	}
	if (typeof record.receiptId !== "string" || record.receiptId.length === 0) {
		throw new SessionRuntimeHandoffError(
			"invalid_ack",
			"Handoff acknowledgment receiptId is invalid.",
		);
	}
	return {
		version: 1,
		commandId: record.commandId,
		ownerVersion: record.ownerVersion as number,
		acceptedPosition: record.acceptedPosition as number,
		receiptId: record.receiptId,
	};
}

export type SessionRuntimeCallClock = {
	now: () => number;
};

export async function withSessionRuntimeCallTimeout<T>(
	operation: () => Promise<T>,
	timeoutMs: number,
	clock?: SessionRuntimeCallClock,
): Promise<T> {
	if (timeoutMs <= 0) {
		throw new SessionRuntimeHandoffError("runtime_timeout", "runtime_timeout");
	}
	const started = clock?.now() ?? Date.now();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const result = await Promise.race([
			operation(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					reject(
						new SessionRuntimeHandoffError(
							"runtime_timeout",
							"runtime_timeout",
						),
					);
				}, timeoutMs);
			}),
		]);
		if (clock && clock.now() - started > timeoutMs) {
			throw new SessionRuntimeHandoffError(
				"runtime_timeout",
				"runtime_timeout",
			);
		}
		return result;
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

type SessionRuntimeResolution = {
	transport?: SessionRuntime;
	trustedAdmissionEligible?: boolean;
	now?: () => number;
	createId?: () => string;
};

const resolution = new AsyncLocalStorage<SessionRuntimeResolution>();

export function withSessionRuntimeResolution<T>(
	overrides: SessionRuntimeResolution,
	run: () => T,
): T {
	const parent = resolution.getStore() ?? {};
	return resolution.run({ ...parent, ...overrides }, run);
}

export function isTrustedAdmissionEligible(): boolean {
	return resolution.getStore()?.trustedAdmissionEligible === true;
}

export function resolveSessionRuntimeTransport(): SessionRuntime {
	return resolution.getStore()?.transport ?? createUnavailableSessionRuntime();
}

export function resolveSessionAdmissionHooks(): {
	now?: () => number;
	createId?: () => string;
} {
	const store = resolution.getStore();
	return { now: store?.now, createId: store?.createId };
}

export function createSessionRuntimeClient(
	transport: SessionRuntime,
	options?: { timeoutMs?: number; clock?: SessionRuntimeCallClock },
): SessionRuntime {
	const timeoutMs = options?.timeoutMs ?? SESSION_RUNTIME_CALL_TIMEOUT_MS;
	const withTimeout = <T>(operation: () => Promise<T>): Promise<T> =>
		withSessionRuntimeCallTimeout(operation, timeoutMs, options?.clock);
	return {
		modelConfiguration: () => withTimeout(() => transport.modelConfiguration()),
		deliver: async (input) =>
			parseSessionRuntimeHandoffAck(
				await withTimeout(() => transport.deliver(input)),
			),
		control: async (input) =>
			parseSessionRuntimeHandoffAck(
				await withTimeout(() => transport.control(input)),
			),
	};
}
