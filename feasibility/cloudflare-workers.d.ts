// The workerd built-ins the simulated AI Worker uses. Feasibility has no workers-types package.
declare module "cloudflare:workers" {
	export abstract class WorkerEntrypoint<Env = unknown> {
		protected env: Env;
		fetch?(request: Request): Response | Promise<Response>;
	}
	export abstract class RpcTarget {}
}
