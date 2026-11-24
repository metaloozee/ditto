// The workerd built-ins the app and @cloudflare/containers use. The tsconfig loads no
// workers-types, which clash with DOM.
declare namespace Cloudflare {
	interface Env {}
}

declare class WebSocketPair {
	0: WebSocket & { accept(): void };
	1: WebSocket & { accept(): void };
}

interface ResponseInit {
	webSocket?: WebSocket | null;
}

declare module "cloudflare:workers" {
	export function waitUntil(promise: Promise<unknown>): void;
	export const env: import("./lib/auth.ts").AuthEnv;

	export interface DurableObjectState {
		readonly container?: { readonly running: boolean };
	}

	export abstract class DurableObject<Env = unknown> {
		protected ctx: DurableObjectState;
		protected env: Env;
		constructor(ctx: DurableObjectState, env: Env);
		fetch?(request: Request): Response | Promise<Response>;
	}
	export abstract class WorkerEntrypoint<Env = unknown, Props = unknown> {
		protected env: Env;
		protected ctx: { props: Props };
		fetch?(request: Request): Response | Promise<Response>;
	}
}
