import { describe, expect, it, vi } from "vitest";
import {
	assertOutgoingGitRangeSafe,
	extractAddedLinesFromUnifiedDiff,
	GitSecretPolicyError,
	isSecretLikeGitPath,
	parseNameStatusZ,
} from "./git-secret-policy";

/** Synthetic only — never a live credential. */
const FIXTURE_GH_TOKEN = `ghp_${"a".repeat(36)}`;
const FIXTURE_PROJECT_SECRET = "proj-secret-value-xyz";

function makeSandbox(
	execImpl: (command: string) => Promise<{
		success: boolean;
		stdout: string;
		stderr: string;
		exitCode: number;
	}>,
) {
	return { exec: vi.fn(execImpl) };
}

function ok(stdout = ""): {
	success: boolean;
	stdout: string;
	stderr: string;
	exitCode: number;
} {
	return { success: true, stdout, stderr: "", exitCode: 0 };
}

function fail(stderr = "error"): {
	success: boolean;
	stdout: string;
	stderr: string;
	exitCode: number;
} {
	return { success: false, stdout: "", stderr, exitCode: 1 };
}

describe("isSecretLikeGitPath", () => {
	it("matches .env basenames including nested", () => {
		expect(isSecretLikeGitPath(".env")).toBe(true);
		expect(isSecretLikeGitPath(".env.local")).toBe(true);
		expect(isSecretLikeGitPath("nested/deep/.env.production")).toBe(true);
		expect(isSecretLikeGitPath("src/a.ts")).toBe(false);
		expect(isSecretLikeGitPath("env")).toBe(false);
		expect(isSecretLikeGitPath("foo.env")).toBe(false);
	});
});

describe("parseNameStatusZ", () => {
	it("parses ordinary and rename records", () => {
		const raw = ["A", "src/a.ts", "R100", "old.ts", "nested/.env", ""].join(
			"\0",
		);
		const entries = parseNameStatusZ(raw);
		expect(entries).toEqual([
			{ status: "A", paths: ["src/a.ts"] },
			{ status: "R100", paths: ["old.ts", "nested/.env"] },
		]);
	});
});

describe("extractAddedLinesFromUnifiedDiff", () => {
	it("collects only added lines", () => {
		const diff = [
			"diff --git a/a.ts b/a.ts",
			"--- a/a.ts",
			"+++ b/a.ts",
			"@@ -1 +1,2 @@",
			"-old",
			"+new line",
			"+second",
		].join("\n");
		const { addedText, binaryPath } = extractAddedLinesFromUnifiedDiff(diff);
		expect(binaryPath).toBeUndefined();
		expect(addedText).toBe("new line\nsecond");
	});

	it("detects binary markers", () => {
		const diff = [
			"diff --git a/bin.dat b/bin.dat",
			"Binary files /dev/null and b/bin.dat differ",
		].join("\n");
		const { binaryPath } = extractAddedLinesFromUnifiedDiff(diff);
		expect(binaryPath).toBe("bin.dat");
	});
});

describe("assertOutgoingGitRangeSafe", () => {
	const base = "basebasebasebasebasebasebasebasebasebase";
	const head = "headheadheadheadheadheadheadheadheadhead";

	function safeRangeSandbox(options?: {
		nameStatusZ?: string;
		diff?: string;
		diffFail?: boolean;
		nameStatusFail?: boolean;
		noUpstream?: boolean;
	}) {
		return makeSandbox(async (command) => {
			if (command === "git rev-parse --verify HEAD") {
				return ok(`${head}\n`);
			}
			if (command === "git rev-parse --verify @{upstream}") {
				if (options?.noUpstream) {
					return fail("no upstream");
				}
				return ok(`${base}\n`);
			}
			if (command.includes("git diff --name-status -z")) {
				if (options?.nameStatusFail) {
					return fail("diff failed");
				}
				return ok(options?.nameStatusZ ?? `M\0src/a.ts\0`);
			}
			if (command.includes("git diff -U0")) {
				if (options?.diffFail) {
					return fail("diff failed");
				}
				return ok(
					options?.diff ??
						[
							"diff --git a/src/a.ts b/src/a.ts",
							"--- a/src/a.ts",
							"+++ b/src/a.ts",
							"@@ -0,0 +1 @@",
							"+export const ok = true;",
						].join("\n"),
				);
			}
			throw new Error(`unexpected command: ${command}`);
		});
	}

	it("allows a safe range", async () => {
		const sandbox = safeRangeSandbox();
		const result = await assertOutgoingGitRangeSafe({
			sandbox,
			cwd: "/wt",
			branchName: "ditto/session-1",
			knownSecrets: [FIXTURE_PROJECT_SECRET],
		});
		expect(result.changedPathCount).toBe(1);
		expect(result.baseRev).toBe(base);
		expect(result.headRev).toBe(head);
	});

	it("blocks secret-like paths without leaking fixtures", async () => {
		const sandbox = safeRangeSandbox({
			nameStatusZ: `A\0config/.env.local\0`,
		});
		let message = "";
		try {
			await assertOutgoingGitRangeSafe({
				sandbox,
				cwd: "/wt",
				branchName: "ditto/session-1",
				knownSecrets: [FIXTURE_PROJECT_SECRET],
			});
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
			expect(error).toBeInstanceOf(GitSecretPolicyError);
			expect((error as GitSecretPolicyError).reason).toBe("secret_path");
		}
		expect(message).toContain("config/.env.local");
		expect(message).not.toContain(FIXTURE_PROJECT_SECRET);
		expect(message).not.toContain(FIXTURE_GH_TOKEN);
		expect(JSON.stringify(sandbox.exec.mock.calls)).not.toContain(
			FIXTURE_PROJECT_SECRET,
		);
	});

	it("blocks rename destination that is secret-like", async () => {
		const sandbox = safeRangeSandbox({
			nameStatusZ: `R100\0src/a.ts\0nested/.env\0`,
		});
		await expect(
			assertOutgoingGitRangeSafe({
				sandbox,
				cwd: "/wt",
				branchName: "ditto/session-1",
			}),
		).rejects.toMatchObject({
			reason: "secret_path",
			blockedPath: "nested/.env",
		});
	});

	it("blocks recognized synthetic credential in added lines", async () => {
		const sandbox = safeRangeSandbox({
			diff: [
				"diff --git a/src/a.ts b/src/a.ts",
				"--- a/src/a.ts",
				"+++ b/src/a.ts",
				"@@ -0,0 +1 @@",
				`+const token = "${FIXTURE_GH_TOKEN}";`,
			].join("\n"),
		});
		let message = "";
		try {
			await assertOutgoingGitRangeSafe({
				sandbox,
				cwd: "/wt",
				branchName: "ditto/session-1",
			});
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
			expect(error).toBeInstanceOf(GitSecretPolicyError);
			expect((error as GitSecretPolicyError).reason).toBe("secret_content");
		}
		expect(message).toContain("recognized secret content");
		expect(message).not.toContain(FIXTURE_GH_TOKEN);
		expect(message).not.toMatch(/ghp_/);
	});

	it("blocks concrete known project secret in added lines", async () => {
		const sandbox = safeRangeSandbox({
			diff: [
				"diff --git a/src/a.ts b/src/a.ts",
				"--- a/src/a.ts",
				"+++ b/src/a.ts",
				"@@ -0,0 +1 @@",
				`+apiKey=${FIXTURE_PROJECT_SECRET}`,
			].join("\n"),
		});
		let message = "";
		try {
			await assertOutgoingGitRangeSafe({
				sandbox,
				cwd: "/wt",
				branchName: "ditto/session-1",
				knownSecrets: [FIXTURE_PROJECT_SECRET],
			});
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain("recognized secret content");
		expect(message).not.toContain(FIXTURE_PROJECT_SECRET);
	});

	it("does not block when secret only appears on deleted lines", async () => {
		const sandbox = safeRangeSandbox({
			diff: [
				"diff --git a/src/a.ts b/src/a.ts",
				"--- a/src/a.ts",
				"+++ b/src/a.ts",
				"@@ -1 +1 @@",
				`-${FIXTURE_GH_TOKEN}`,
				"+safe replacement",
			].join("\n"),
		});
		const result = await assertOutgoingGitRangeSafe({
			sandbox,
			cwd: "/wt",
			branchName: "ditto/session-1",
			knownSecrets: [FIXTURE_PROJECT_SECRET],
		});
		expect(result.changedPathCount).toBe(1);
	});

	it("blocks binary/unreadable changes", async () => {
		const sandbox = safeRangeSandbox({
			nameStatusZ: `A\0bin.dat\0`,
			diff: [
				"diff --git a/bin.dat b/bin.dat",
				"Binary files /dev/null and b/bin.dat differ",
			].join("\n"),
		});
		await expect(
			assertOutgoingGitRangeSafe({
				sandbox,
				cwd: "/wt",
				branchName: "ditto/session-1",
			}),
		).rejects.toMatchObject({ reason: "binary_or_unreadable" });
	});

	it("blocks when git path listing fails", async () => {
		const sandbox = safeRangeSandbox({ nameStatusFail: true });
		await expect(
			assertOutgoingGitRangeSafe({
				sandbox,
				cwd: "/wt",
				branchName: "ditto/session-1",
			}),
		).rejects.toMatchObject({ reason: "git_failed" });
	});

	it("blocks when git content diff fails", async () => {
		const sandbox = safeRangeSandbox({ diffFail: true });
		await expect(
			assertOutgoingGitRangeSafe({
				sandbox,
				cwd: "/wt",
				branchName: "ditto/session-1",
			}),
		).rejects.toMatchObject({ reason: "git_failed" });
	});

	it("blocks when outgoing range cannot be resolved", async () => {
		const sandbox = makeSandbox(async (command) => {
			if (command === "git rev-parse --verify HEAD") {
				return ok(`${head}\n`);
			}
			if (command === "git rev-parse --verify @{upstream}") {
				return fail("no upstream");
			}
			if (command.includes("git rev-parse --verify 'origin/")) {
				return fail("missing");
			}
			if (command === "git rev-parse --verify origin/HEAD") {
				return fail("missing");
			}
			if (command === "git rev-list -n 1 --remotes=origin") {
				return fail("none");
			}
			if (command === "git hash-object -t tree /dev/null") {
				return fail("no git");
			}
			throw new Error(`unexpected command: ${command}`);
		});
		await expect(
			assertOutgoingGitRangeSafe({
				sandbox,
				cwd: "/wt",
				branchName: "ditto/session-1",
			}),
		).rejects.toMatchObject({ reason: "range_unresolved" });
	});
});
