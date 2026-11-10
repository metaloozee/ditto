import { expect, it } from "vitest";
import {
	configurationIdentity,
	parseCandidateModelsRequestV1,
	parseCandidateModelsV1,
	parseConfigurationAckV1,
	parseConfigurationIntentV1,
	parseConfigurationReadV1,
	parseConfigurationSelectionV1,
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
	{ ...intent, selection: { model: "not valid", thinking: "off" } },
	{ ...intent, selection: { model: "faux-1", thinking: "ultra" } },
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

it("parses candidate models and refuses inconsistent or extra fields", () => {
	const models = {
		version: 1,
		status: "available",
		models: [{ id: "faux-1", thinking: ["off", "low"] }],
		selection: { model: "faux-1", thinking: "off" },
	};
	expect(parseCandidateModelsV1(models)).toEqual(models);
	expect(
		parseCandidateModelsV1({
			version: 1,
			status: "disconnected",
			models: [],
			selection: null,
		}),
	).toMatchObject({ status: "disconnected" });
	expect(() =>
		parseCandidateModelsV1({ ...models, status: "disconnected" }),
	).toThrow();
	expect(() => parseCandidateModelsV1({ ...models, extra: 1 })).toThrow();
	expect(() =>
		parseCandidateModelsV1({
			...models,
			models: [{ id: "faux-1", thinking: ["off", "off"] }],
		}),
	).toThrow();
	expect(parseCandidateModelsRequestV1({ version: 1, projectId: "p" })).toEqual(
		{ version: 1, projectId: "p" },
	);
	expect(() =>
		parseCandidateModelsRequestV1({ version: 1, projectId: "p", userId: "u" }),
	).toThrow();
});

it("widens the selection to codex models and thinking levels", () => {
	expect(
		parseConfigurationSelectionV1({ model: "gpt-6.1-sol", thinking: "xhigh" }),
	).toEqual({ model: "gpt-6.1-sol", thinking: "xhigh" });
	expect(
		parseConfigurationSelectionV1({ model: "faux-1", thinking: "off" }),
	).toEqual({ model: "faux-1", thinking: "off" });
	expect(() =>
		parseConfigurationSelectionV1({ model: "a b", thinking: "low" }),
	).toThrow();
	expect(() =>
		parseConfigurationSelectionV1({ model: "gpt-6", thinking: "ultra" }),
	).toThrow();
});

it("bounds the candidate model list at sixteen codex models", () => {
	const list = (n: number) => ({
		version: 1,
		status: "available",
		models: Array.from({ length: n }, (_, i) => ({
			id: `gpt-6.1-model-${i}`,
			thinking: ["low", "high"],
		})),
		selection: null,
	});
	expect(parseCandidateModelsV1(list(16)).models).toHaveLength(16);
	expect(() => parseCandidateModelsV1(list(17))).toThrow();
});
