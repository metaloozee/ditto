import { WorkerEntrypoint } from "cloudflare:workers";
import { createDb } from "#/db";
import { createProductAdapters } from "#/lib/session-runtime-authority";
import type {
	ModelTransportDescriptorV1,
	SyntheticModelOutcomeV1,
} from "../../../../packages/runtime-contracts/src/model.js";
import type {
	ProjectionApplyResult,
	ProjectionPayload,
} from "../../../runtime/src/product-projector.js";
import type {
	CurrentAuthority,
	ReconstructedAdmission,
} from "../../../runtime/src/session-runtime.js";
import type { ModelClaimRpc } from "./model-product-authority";
import {
	performPrivateModelRequest,
	readPrivateModelPermit,
} from "./model-product-transport";

function productEnv(env: Env): { DB: D1Database } | null {
	if (!env || typeof env !== "object" || !("DB" in env) || !env.DB) {
		return null;
	}
	return { DB: env.DB };
}

export class ProductEntrypoint extends WorkerEntrypoint<Env> {
	async readConfigurationAuthority(
		_input: unknown,
		_selection?: unknown,
	): Promise<
		import("../../../../packages/runtime-contracts/src/configuration.js").ConfigurationAuthorityV1
	> {
		return { version: 1, status: "unavailable" };
	}
	async requestModel(
		input: unknown,
		capability: ModelClaimRpc,
	): Promise<SyntheticModelOutcomeV1> {
		return performPrivateModelRequest(this.env, input, capability, false);
	}
	async readModelPermit(
		input: unknown,
		descriptor: ModelTransportDescriptorV1,
	) {
		return readPrivateModelPermit(this.env.DB, input, descriptor, false);
	}
	async discoverModels(
		commandId: string,
	): Promise<{ version: 1; status: "unavailable" | "revoked" }> {
		const row = await this.env.DB.prepare(
			"SELECT k.revoked FROM session_commands c JOIN codex_connections k ON k.user_id=c.userId WHERE c.id=?",
		)
			.bind(commandId)
			.first<{ revoked: number }>();
		return { version: 1, status: row?.revoked ? "revoked" : "unavailable" };
	}
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
