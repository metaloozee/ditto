import { expect, it } from "vitest";
import { bounded, deferred, gate, piState, product, selectionIntent } from "../configuration-advisor/fixture-copy.ts";

for (const encrypted of [false, true])
	it(`correction snapshots: final local authority, encrypted=${encrypted}`, async () => {
		let configured = false, selectionCalls = 0, revoked = false;
		const entered = deferred(), released = deferred();
		const reads: { current: boolean; generation: number; executor: number }[] = [];
		await gate(`correction-snapshot-authority-${encrypted}`, async (f) => {
			const before = await piState(f.storage);
			configured = true;
			const pending = f.host.configureOwned(selectionIntent());
			try { await bounded(entered.promise); revoked = true; } finally { released.resolve(); }
			const ack = await bounded(pending), after = await piState(f.storage);
			expect(ack.status).toBe("denied");
			expect(after).toBe(before);
			console.log("[007-correction-snapshot]", JSON.stringify({ kind: "authority", encrypted, reads, ack, piBefore: before, piAfter: after, product: await f.snapshot() }));
		}, {
			owned: true, encrypted,
			localAuthority: async (current, generation) => {
				const result = { current: current && !revoked, generation, executor: 1 };
				if (configured) reads.push(result);
				return result;
			},
			configurationAuthority: async (query, selection) => {
				const result = await product.readConfigurationAuthority(query, selection);
				if (configured && selection && ++selectionCalls === 6) { entered.resolve(); await released.promise; }
				return result;
			},
		});
	});

it("correction snapshots: encrypted pending phase metadata", async () => {
	let crashed = false;
	await gate("correction-snapshot-integrity", async (f) => {
		await expect(f.host.configureOwned(selectionIntent("interrupted"))).rejects.toThrow("Snapshot pending crash");
		const piBefore = await piState(f.storage);
		const original = f.storage.sql.exec<{ id: string; payload_digest: string; state: string; outcome: string }>("SELECT * FROM host_configuration_intents").one();
		f.storage.sql.exec("UPDATE host_configuration_intents SET state='complete'");
		const corrupted = f.storage.sql.exec("SELECT id,payload_digest,state FROM host_configuration_intents").one();
		await expect(f.reopen()).rejects.toThrow(/integrity/i);
		const piAfter = await piState(f.storage);
		expect(piAfter).toBe(piBefore);
		expect(f.storage.sql.exec<{ outcome: string }>("SELECT outcome FROM host_configuration_intents").one().outcome).toBe(original.outcome);
		const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(original.outcome))), (byte) => byte.toString(16).padStart(2, "0")).join("");
		console.log("[007-correction-snapshot]", JSON.stringify({ kind: "integrity", original: { id: original.id, payload_digest: original.payload_digest, state: original.state, ciphertextDigest: digest }, corrupted: { ...corrupted, ciphertextDigest: digest }, reopen: "integrity_rejected", piBefore, piAfter, product: await f.snapshot() }));
	}, { owned: true, encrypted: true, configurationFault: (point) => {
		if (!crashed && point === "configuration-intent") { crashed = true; throw new Error("Snapshot pending crash"); }
	}});
});
