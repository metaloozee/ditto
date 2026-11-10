import { describe, expect, it } from "vitest";
import {
	openCredentials,
	openDeviceAuth,
	sealCredentials,
	sealDeviceAuth,
} from "./codex-credential-crypto";

const tokens = {
	access: "fake-access-token-XYZ",
	refresh: "fake-refresh-token-XYZ",
	expiresAt: 1234,
};
const keyring = { current: "k1", keys: { k1: "01".repeat(32) } };

describe("credential and device sealing", () => {
	it("round-trips tokens", async () => {
		const sealed = await sealCredentials(tokens, "owner", 1, keyring);
		expect(await openCredentials(sealed, "owner", 1, keyring)).toEqual(tokens);
	});
	it("round-trips a device id without leaking it", async () => {
		const sealed = await sealDeviceAuth("fake-device-id", "owner", 2, keyring);
		expect(sealed).not.toContain("fake-device-id");
		expect(await openDeviceAuth(sealed, "owner", 2, keyring)).toBe(
			"fake-device-id",
		);
		await expect(openDeviceAuth(sealed, "owner", 3, keyring)).rejects.toThrow(
			"credential_integrity",
		);
		await expect(openDeviceAuth(sealed, "foreign", 2, keyring)).rejects.toThrow(
			"credential_integrity",
		);
	});
	it("never opens a device record as tokens or the reverse", async () => {
		const device = await sealDeviceAuth("fake-device-id", "owner", 1, keyring);
		const sealed = await sealCredentials(tokens, "owner", 1, keyring);
		await expect(openCredentials(device, "owner", 1, keyring)).rejects.toThrow(
			"credential_integrity",
		);
		await expect(openDeviceAuth(sealed, "owner", 1, keyring)).rejects.toThrow(
			"credential_integrity",
		);
	});
});
