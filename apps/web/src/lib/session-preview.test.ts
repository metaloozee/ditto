import { describe, expect, it, vi } from "vitest";

vi.mock("#/lib/sandbox-bootstrap", () => ({ getProjectSandbox: vi.fn() }));

import {
	discoverPreviewCommand,
	isAstroVersionSupported,
	isViteVersionSupported,
	parseLeadingSemver,
	resolvePreviewHostname,
	validatePreviewUrl,
} from "./session-preview";

function previewSandbox(packageJson: unknown, files: Record<string, unknown>) {
	return {
		exists: vi.fn(async (path: string) => ({
			exists: path === "/workspace/package.json" || path in files,
		})),
		readFile: vi.fn(async (path: string) => ({
			content:
				path === "/workspace/package.json"
					? JSON.stringify(packageJson)
					: JSON.stringify(files[path]),
		})),
	};
}

describe("preview policy", () => {
	it("parses strict installed versions", () => {
		expect(parseLeadingSemver("6.1.0")).toEqual([6, 1, 0]);
		expect(parseLeadingSemver("v6.1.0")).toBeNull();
		expect(isViteVersionSupported("6.1.0")).toBe(true);
		expect(isViteVersionSupported("6.0.9")).toBe(false);
		expect(isAstroVersionSupported("5.4.0")).toBe(true);
	});

	it("accepts only the configured local or production host", () => {
		expect(
			resolvePreviewHostname({
				requestUrl: "http://localhost:5173/project/1",
				previewBaseHost: undefined,
			}),
		).toBe("localhost:5173");
		expect(
			resolvePreviewHostname({
				requestUrl: "https://ayn.wtf/project/1",
				previewBaseHost: "ayn.wtf",
			}),
		).toBe("ayn.wtf");
		expect(() =>
			resolvePreviewHostname({
				requestUrl: "https://evil.ayn.wtf/project/1",
				previewBaseHost: "ayn.wtf",
			}),
		).toThrow();
	});

	it("builds the fixed Vite command without project environment values", async () => {
		const sandbox = previewSandbox(
			{
				scripts: { dev: "vite" },
				devDependencies: { vite: "^6.1.0" },
			},
			{
				"/workspace/node_modules/vite/package.json": { version: "6.1.0" },
				"/workspace/node_modules/.bin/vite": {},
			},
		);
		const result = await discoverPreviewCommand({
			sandbox: sandbox as never,
			cwd: "/workspace",
			port: 10000,
		});
		expect(result.command).toBe(
			"./node_modules/.bin/vite --host 0.0.0.0 --port 10000 --strictPort",
		);
		expect(result.env).toEqual({
			HOST: "0.0.0.0",
			PORT: "10000",
			__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: ".ayn.wtf",
		});
	});

	it("rejects preview URLs with credentials or nested production hosts", () => {
		expect(() =>
			validatePreviewUrl({
				url: "https://user:pass@10000-sandbox.ayn.wtf/",
				port: 10000,
				hostname: "ayn.wtf",
				local: false,
			}),
		).toThrow();
		expect(() =>
			validatePreviewUrl({
				url: "https://nested.10000-sandbox.ayn.wtf/",
				port: 10000,
				hostname: "ayn.wtf",
				local: false,
			}),
		).toThrow();
	});
});
