import { WorkerEntrypoint } from "cloudflare:workers";
import type { ModelTransportDescriptorV1 } from "/home/ayan/ditto-execution/plan-007-recovery/packages/runtime-contracts/src/model.js";
import type { ModelClaimRpc } from "/home/ayan/ditto-execution/plan-007-recovery/apps/web/src/lib/model-product-authority";
import {
	type ModelProductBindings,
	performPrivateModelRequest,
	readPrivateModelPermit,
} from "/home/ayan/ditto-execution/plan-007-recovery/apps/web/src/lib/model-product-transport";

export { PiDurableHostFixture } from "/home/ayan/ditto-execution/plan-007-recovery/apps/runtime/src/pi-durable-host.ts";
export { CodexCredential, FixtureCredential } from "/home/ayan/ditto-execution/plan-007-recovery/apps/credential-tests/src/entry";

import { readOwnedConfigurationAuthority } from "/home/ayan/ditto-execution/plan-007-recovery/apps/web/src/lib/configuration-product-authority";

export class FixtureProduct extends WorkerEntrypoint<ModelProductBindings> {
	async readConfigurationAuthority(input: unknown, selection?: unknown) {
		const start = performance.now();
        const credential =
			await this.env.CodexCredential.getByName("owner").status("owner");
        const credentialMs = performance.now()-start;
		if (
			selection !== undefined &&
			(credential.status !== "connected" || credential.generation !== 1)
		)
			return { version: 1 as const, status: "denied" as const };
		const result = await readOwnedConfigurationAuthority(
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
        console.log('[007-product-timing]', JSON.stringify({selection: selection !== undefined, credentialMs, policyMs: performance.now()-start-credentialMs}));
        return result;
	}
	async readSecondConfigurationAuthority(input: unknown, selection?: unknown) {
		const start = performance.now();
        const credential =
			await this.env.CodexCredential.getByName("owner").status("owner");
        const credentialMs = performance.now()-start;
		if (
			selection !== undefined &&
			(credential.status !== "connected" || credential.generation !== 1)
		)
			return { version: 1 as const, status: "denied" as const };
		const result = await readOwnedConfigurationAuthority(
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
        console.log('[007-product-timing]', JSON.stringify({selection: selection !== undefined, credentialMs, policyMs: performance.now()-start-credentialMs}));
        return result;
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
