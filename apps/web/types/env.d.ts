// This file infers Cloudflare binding types from the Alchemy Worker.
// @see https://alchemy.run/concepts/bindings/#type-safe-bindings

import type { WebsiteEnv } from "../../../alchemy.run.ts";

export type CloudflareEnv = WebsiteEnv;

declare global {
	type Env = CloudflareEnv;
}

declare module "cloudflare:workers" {
	namespace Cloudflare {
		export interface Env extends CloudflareEnv {}
	}
}
