declare module "cloudflare:workers" {
	export function waitUntil(promise: Promise<unknown>): void;
	export const env: import("./lib/auth.ts").AuthEnv;
}
