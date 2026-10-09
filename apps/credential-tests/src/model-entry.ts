import { WorkerEntrypoint } from "cloudflare:workers";
import type { ModelTransportDescriptorV1 } from "../../../packages/runtime-contracts/src/model.js";
import type { ModelClaimRpc } from "../../web/src/lib/model-product-authority";
import {
	type ModelProductBindings,
	performPrivateModelRequest,
	readPrivateModelPermit,
} from "../../web/src/lib/model-product-transport";

export { PiDurableHostFixture } from "../../runtime/src/pi-durable-host.ts";
export { CodexCredential, FixtureCredential } from "./entry";

import { readOwnedConfigurationAuthority } from "../../web/src/lib/configuration-product-authority";

export class FixtureProduct extends WorkerEntrypoint<ModelProductBindings> {
	async readConfigurationAuthority(input: unknown, selection?: unknown) {
		const credential =
			await this.env.CodexCredential.getByName("owner").status("owner");
		if (
			selection !== undefined &&
			(credential.status !== "connected" || credential.generation !== 1)
		)
			return { version: 1 as const, status: "denied" as const };
		return readOwnedConfigurationAuthority(
			this.env.DB,
			{
				version: 1,
				userId: "owner",
				projectId: "project",
				workspaceSessionId: "session",
				identityId: "executor",
				incarnationId: "incarnation",
				controllerNamespace: "fixture-execution-v1",
				lifecycleGeneration: 1,
				runtimeOwnerVersion: 1,
				connectionGeneration: 1,
				capabilityRevision: 1,
			},
			input,
			selection,
			true,
		);
	}
	async readSecondConfigurationAuthority(input: unknown, selection?: unknown) {
		const credential =
			await this.env.CodexCredential.getByName("owner").status("owner");
		if (
			selection !== undefined &&
			(credential.status !== "connected" || credential.generation !== 1)
		)
			return { version: 1 as const, status: "denied" as const };
		return readOwnedConfigurationAuthority(
			this.env.DB,
			{
				version: 1,
				userId: "owner",
				projectId: "project",
				workspaceSessionId: "session-2",
				identityId: "executor-2",
				incarnationId: "incarnation-2",
				controllerNamespace: "fixture-execution-v1",
				lifecycleGeneration: 1,
				runtimeOwnerVersion: 1,
				connectionGeneration: 1,
				capabilityRevision: 1,
			},
			input,
			selection,
			true,
		);
	}
	requestModel(input: unknown, capability: ModelClaimRpc) {
		return performPrivateModelRequest(this.env, input, capability, true);
	}
	readModelPermit(input: unknown, descriptor: ModelTransportDescriptorV1) {
		return readPrivateModelPermit(this.env.DB, input, descriptor, true);
	}
	fetch() {
		return new Response("Not found", { status: 404 });
	}
}
export default FixtureProduct;
