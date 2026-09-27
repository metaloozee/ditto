import { WorkerEntrypoint } from "cloudflare:workers";
import { createDb } from "#/db";
import { createProductAdapters } from "#/lib/session-runtime-authority";
import type {
	ProjectionApplyResult,
	ProjectionPayload,
} from "../../../runtime/src/product-projector.js";
import type {
	CurrentAuthority,
	ReconstructedAdmission,
} from "../../../runtime/src/session-runtime.js";

function productEnv(env: Env): { DB: D1Database } | null {
	if (!env || typeof env !== "object" || !("DB" in env) || !env.DB) {
		return null;
	}
	return { DB: env.DB };
}

export class ProductEntrypoint extends WorkerEntrypoint<Env> {
	private adapters() {
		const bindings = productEnv(this.env);
		if (!bindings) return null;
		return createProductAdapters(createDb(bindings), bindings.DB);
	}

	async reconstructCommand(
		commandId: string,
	): Promise<ReconstructedAdmission | null> {
		const adapters = this.adapters();
		if (!adapters) return null;
		return adapters.reconstructCommand(commandId);
	}

	async readCurrentAuthority(input: {
		workspaceSessionId: string;
		userId: string;
		projectId: string;
	}): Promise<CurrentAuthority | null> {
		const adapters = this.adapters();
		if (!adapters) return null;
		return adapters.readCurrentAuthority(input);
	}

	async applyProjections(
		payloads: ProjectionPayload[],
		now: number,
	): Promise<ProjectionApplyResult[]> {
		const adapters = this.adapters();
		if (!adapters) return [];
		return adapters.applyProjections(payloads, now);
	}

	async resolveWorkspaceSessionId(commandId: string): Promise<string | null> {
		const reconstructed = await this.reconstructCommand(commandId);
		return reconstructed?.command.workspaceSessionId ?? null;
	}

	async readExecutionPrerequisites(input: {
		workspaceSessionId: string;
		userId: string;
		projectId: string;
	}) {
		const adapters = this.adapters();
		if (!adapters) return null;
		return adapters.readExecutionPrerequisites(input);
	}
}
