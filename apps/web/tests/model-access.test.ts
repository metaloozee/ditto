import { describe, expect, it } from "vite-plus/test";

import {
	canMessage,
	interruptionActions,
	type Connection,
	type ModelAccess,
	pairGroups,
	pairLabel,
	stateView,
} from "../src/lib/model-access.ts";

const opencode = (state: Connection["state"], resetsAt?: Date): Connection => ({
	id: "oc-1",
	provider: "opencode",
	state,
	resetsAt,
	models: ["Model A", "Model B"],
});

describe("what a connection's state shows", () => {
	it("gives each state its label and one action at most", () => {
		expect(stateView(opencode("Connected"))).toEqual({
			label: "Connected",
			tone: "success",
			action: { kind: "disconnect", label: "Disconnect", primary: false },
		});
		expect(stateView(opencode("Refreshing"))).toEqual({ label: "Refreshing", tone: "busy" });
		expect(stateView(opencode("Unavailable"))).toEqual({
			label: "Unavailable",
			tone: "muted",
			detail: "OpenCode isn’t responding. Ditto keeps checking.",
			action: { kind: "check", label: "Check again", primary: false },
		});
		expect(stateView(opencode("ReconnectNeeded"))).toEqual({
			label: "Reconnect needed",
			tone: "destructive",
			detail: "OpenCode no longer accepts this key.",
			action: { kind: "reconnect", label: "Reconnect", primary: true },
		});
	});

	it("names the sign-in, not a key, when a ChatGPT plan needs reconnecting", () => {
		const plan: Connection = { ...opencode("ReconnectNeeded"), provider: "chatgpt" };
		expect(stateView(plan).detail).toBe("OpenAI no longer accepts this sign-in.");
	});

	it("shows a reset time only when the provider supplied one", () => {
		const resetsAt = new Date("2026-11-26T15:40:00Z");
		expect(stateView(opencode("Throttled", resetsAt), { timeZone: "UTC" })).toEqual({
			label: "Limit reached",
			tone: "muted",
			detail: "Resets at 3:40 PM",
		});
		expect(stateView(opencode("Throttled")).detail).toBe("Your bots carry on when it lifts.");
	});
});

describe("picking a pair", () => {
	const plan: Connection = {
		id: "gpt-1",
		provider: "chatgpt",
		state: "ReconnectNeeded",
		models: ["Model D"],
	};
	const access: ModelAccess = {
		connections: [opencode("Refreshing"), plan],
		included: "Model C",
	};

	it("groups models by connection and lists an unusable one disabled with its state", () => {
		expect(pairGroups(access)).toEqual([
			{
				key: "oc-1",
				label: "OpenCode",
				disabled: false,
				pairs: [
					{ connectionId: "oc-1", model: "Model A" },
					{ connectionId: "oc-1", model: "Model B" },
				],
			},
			{
				key: "gpt-1",
				label: "ChatGPT plan",
				status: "Reconnect needed",
				disabled: true,
				pairs: [{ connectionId: "gpt-1", model: "Model D" }],
			},
			{
				key: "included",
				label: "Included",
				disabled: false,
				pairs: [{ connectionId: "included", model: "Model C" }],
			},
		]);
	});

	it("leaves the included model out when the operator has not enabled it", () => {
		expect(pairGroups({ connections: [plan] }).map((group) => group.key)).toEqual(["gpt-1"]);
	});

	it("names a pair by its model, then where it runs", () => {
		expect(pairLabel(access, { connectionId: "oc-1", model: "Model A" })).toBe(
			"Model A · OpenCode",
		);
		expect(pairLabel(access, { connectionId: "included", model: "Model C" })).toBe(
			"Model C · Included",
		);
	});

	it("lets the owner message a bot only with a usable connection or the included model", () => {
		expect(canMessage(access)).toBe(true);
		expect(canMessage({ connections: [plan] })).toBe(false);
		expect(canMessage({ connections: [plan], included: "Model C" })).toBe(true);
		expect(canMessage({ connections: [opencode("Throttled")] })).toBe(false);
		expect(canMessage({ connections: [] })).toBe(false);
	});
});

describe("the interruption card's actions", () => {
	const turn = { connectionId: "oc-1", model: "Model A" };
	const other = { connectionId: "oc-1", model: "Model B" };

	it("offers to resume a limited turn on the default pair only when it differs", () => {
		expect(interruptionActions("Throttled", turn, other)).toEqual([
			{ kind: "resume", pair: other, primary: true },
			{ kind: "settings", primary: false },
		]);
		expect(interruptionActions("Throttled", turn, { ...turn })).toEqual([
			{ kind: "settings", primary: false },
		]);
		expect(interruptionActions("Throttled", turn, undefined)).toEqual([
			{ kind: "settings", primary: false },
		]);
	});

	it("asks to check again or reconnect, and offers nothing once settled", () => {
		expect(interruptionActions("Unavailable", turn, other)).toEqual([
			{ kind: "check", primary: false },
		]);
		expect(interruptionActions("ReconnectNeeded", turn, other)).toEqual([
			{ kind: "reconnect", primary: true },
		]);
		expect(interruptionActions("Settled", turn, other)).toEqual([]);
	});
});
