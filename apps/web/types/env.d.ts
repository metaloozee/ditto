// This file infers Cloudflare binding types from the Alchemy Worker.
// @see https://alchemy.run/concepts/bindings/#type-safe-bindings

import type { website } from "../../../alchemy.run.ts"

export type CloudflareEnv = typeof website.Env & {
	// Runtime service binding for candidate preview hosts; unbound until deployment wiring.
	CANDIDATE_PREVIEW?: Fetcher
	PI_DURABLE_PRODUCT_COMMANDS?: import("../src/lib/session-runtime-client").CandidateProductCommandService
}

declare global {
	type Env = CloudflareEnv
}

declare module "cloudflare:workers" {
	namespace Cloudflare {
		export interface Env extends CloudflareEnv {}
	}
}
