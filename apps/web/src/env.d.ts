declare module "cloudflare:workers" {
	export const env: import("./lib/auth.ts").AuthEnv;
}
