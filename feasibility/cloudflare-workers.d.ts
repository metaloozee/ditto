// The workerd built-ins the simulated AI Worker and the Containers trial's Durable Object use.
// Feasibility has no workers-types package.
declare namespace Cloudflare {
	interface Env {}
}

interface AlarmInvocationInfo {
	readonly isRetry: boolean;
	readonly retryCount: number;
}

declare module "cloudflare:workers" {
	type Port = { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };

	export interface DurableObjectState {
		readonly id: { toString(): string };
		readonly container?: {
			readonly running: boolean;
			start(options?: {
				env?: Record<string, string>;
				entrypoint?: string[];
				enableInternet?: boolean;
				labels?: Record<string, string>;
			}): void;
			monitor(): Promise<void>;
			destroy(error?: unknown): Promise<void>;
			signal(signo: number): void;
			getTcpPort(port: number): Port;
		};
		readonly storage: {
			get<T>(key: string): Promise<T | undefined>;
			put(key: string, value: unknown): Promise<void>;
			delete(key: string): Promise<boolean>;
			setAlarm(scheduledTime: number): Promise<void>;
			deleteAlarm(): Promise<void>;
			sync(): Promise<void>;
		};
		blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
	}

	export abstract class DurableObject<Env = unknown> {
		protected ctx: DurableObjectState;
		protected env: Env;
		constructor(ctx: DurableObjectState, env: Env);
		fetch?(request: Request): Response | Promise<Response>;
		alarm?(alarmInfo?: AlarmInvocationInfo): void | Promise<void>;
	}
	export abstract class WorkerEntrypoint<Env = unknown, Props = unknown> {
		protected env: Env;
		protected ctx: { props: Props };
		fetch?(request: Request): Response | Promise<Response>;
	}
	export abstract class RpcTarget {}
}
