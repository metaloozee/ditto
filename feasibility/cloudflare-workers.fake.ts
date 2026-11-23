// `cloudflare:workers` for the feasibility tests, which run in Node, not workerd. Only the base
// classes: the platform each test needs is faked beside it (containers-platform.fake.ts).
export class DurableObject<Env = unknown> {
	constructor(
		protected ctx: unknown,
		protected env: Env,
	) {}
}

export class WorkerEntrypoint<Env = unknown> {
	constructor(
		protected ctx: unknown,
		protected env: Env,
	) {}
}

export class RpcTarget {}
