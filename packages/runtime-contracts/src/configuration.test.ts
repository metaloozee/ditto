import { expect, it } from "vitest";
import {
	configurationIdentity,
	parseConfigurationAckV1,
	parseConfigurationIntentV1,
	parseConfigurationReadV1,
	parseConfigurationSnapshotV1,
} from "./configuration.js";
import type { ModelSubjectV1 } from "./model.js";

const intent = {
	version: 1,
	intentId: "selection-1",
	projectId: "project",
	workspaceSessionId: "session",
	ownerVersion: 1,
	selection: { model: "faux-2", thinking: "low" },
};
const subject: ModelSubjectV1 = {
	version: 1,
	userId: "owner",
	projectId: "project",
	workspaceSessionId: "session",
	identityId: "identity",
	incarnationId: "incarnation",
	controllerNamespace: "fixture",
	lifecycleGeneration: 1,
	runtimeOwnerVersion: 1,
	connectionGeneration: 1,
	capabilityRevision: 1,
};
it("configuration identity is canonical and owner/session/payload scoped", async () => {
	const original = await configurationIdentity(subject, intent);
	expect(
		await configurationIdentity(
			subject,
			JSON.stringify({
				selection: { thinking: "low", model: "faux-2" },
				ownerVersion: 1,
				workspaceSessionId: "session",
				projectId: "project",
				intentId: "selection-1",
				version: 1,
			}),
		),
	).toEqual(original);
	expect(
		(await configurationIdentity({ ...subject, userId: "other" }, intent)).key,
	).not.toBe(original.key);
	expect(
		(
			await configurationIdentity(subject, {
				...intent,
				workspaceSessionId: "other",
			})
		).key,
	).not.toBe(original.key);
	const changed = await configurationIdentity(subject, {
		...intent,
		selection: { model: "faux-1", thinking: "off" },
	});
	expect(changed.key).toBe(original.key);
	expect(changed.payload).not.toBe(original.payload);
});
for (const invalid of [
	{ ...intent, userId: "owner" },
	{ ...intent, ownerVersion: 0 },
	{ ...intent, intentId: "x".repeat(257) },
	{ ...intent, selection: { model: "arbitrary", thinking: "off" } },
	{ ...intent, selection: { model: "faux-1", thinking: "medium" } },
	{ ...intent, selection: { ...intent.selection, extra: true } },
	JSON.stringify(intent).replace('"version":1', '"version":1,"version":1'),
])
	it("strict configuration intents reject malformed authority and values", () =>
		expect(() => parseConfigurationIntentV1(invalid)).toThrow());
it("separate snapshots and acknowledgments stay strict", () => {
	const query = {
		version: 1,
		projectId: "project",
		workspaceSessionId: "session",
		ownerVersion: 1,
	};
	const snapshot = { ...query, selection: intent.selection };
	expect(parseConfigurationSnapshotV1(snapshot)).toEqual(snapshot);
	expect(() =>
		parseConfigurationReadV1({ ...query, selectedModel: "faux-1" }),
	).toThrow();
	expect(() =>
		parseConfigurationSnapshotV1({ ...snapshot, extra: true }),
	).toThrow();
	expect(
		parseConfigurationAckV1({
			version: 1,
			intentId: "selection-1",
			status: "applied",
			snapshot,
		}),
	).toMatchObject({ status: "applied", snapshot });
	expect(() =>
		parseConfigurationAckV1({
			version: 1,
			intentId: "selection-1",
			status: "applied",
			snapshot,
			extra: true,
		}),
	).toThrow();
});
