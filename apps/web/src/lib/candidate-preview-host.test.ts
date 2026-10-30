import { describe, expect, it } from "vitest";
import {
	isCandidatePreviewHost,
	isCandidatePreviewUrl,
} from "./candidate-preview-host";

const U = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const label = `10000-c-${U}-tok`;

describe("isCandidatePreviewHost", () => {
	it.each([
		`${label}.ayn.wtf`,
		`${label}.ayn.wtf`.toUpperCase(),
		`10000-c-${U}-a_b.localhost`,
	])("accepts %s", (host) => {
		expect(isCandidatePreviewHost(host)).toBe(true);
	});

	it.each([
		`10000-${U}-tok.ayn.wtf`,
		`3000-c-${U}-tok.ayn.wtf`,
		"10000-c-notauuid-tok.ayn.wtf",
		`x.${label}.ayn.wtf`,
		`${label}.ayn.wtf.evil.com`,
		`10000-c-${U}-${"a".repeat(17)}.ayn.wtf`,
		"ayn.wtf",
	])("rejects %s", (host) => {
		expect(isCandidatePreviewHost(host)).toBe(false);
	});
});

describe("isCandidatePreviewUrl", () => {
	it.each([
		`https://${label}.ayn.wtf/`,
		`http://${label}.localhost:5173/`,
	])("accepts %s", (url) => {
		expect(isCandidatePreviewUrl(url)).toBe(true);
	});

	it.each([
		`http://${label}.ayn.wtf/`,
		`https://${label}.ayn.wtf:8443/`,
		`https://user:pw@${label}.ayn.wtf/`,
		"javascript:alert(1)",
		"not a url",
	])("rejects %s", (url) => {
		expect(isCandidatePreviewUrl(url)).toBe(false);
	});
});
