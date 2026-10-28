import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
	ARCHIVE_COMPATIBILITY_KEY,
	ARCHIVE_FORMAT_VERSION,
} from "../../../packages/runtime-contracts/src/artifacts.js";
import { readCandidateBaselineSource } from "../../web/src/lib/candidate-baseline";
import type { CandidateFetchScope } from "../../web/src/lib/candidate-branch-fetch";

// @ts-expect-error The Vite glob typing is not in this package's types.
const migrations = import.meta.glob("../../web/migrations/*.sql", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

const scope: CandidateFetchScope = {
	userId: "owner",
	projectId: "project",
	workspaceSessionId: "session",
	ownerVersion: 1,
};
const COMMIT = "a".repeat(40);
const DIGEST = "b".repeat(64);
const OBJECT_KEY = "project_seed/project/0/archive.tar.gz";
const INSTALLATION = 987654321;

async function seed(
	options: {
		branch?: string | null;
		buildState?: string;
		archiveStatus?: string;
		archiveOwner?: string;
		extractedBytes?: number | null;
		compatibilityKey?: string;
	} = {},
) {
	const branch =
		options.branch === undefined ? "ditto/session" : options.branch;
	await env.DB.batch([
		env.DB.prepare(
			"INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('owner','o','o@example.invalid',0,0)",
		),
		env.DB.prepare(
			"INSERT INTO projects(id,name,userId,status,githubRepo,githubInstallationId) VALUES('project','p','owner','ready','acme/app',?)",
		).bind(INSTALLATION),
		env.DB.prepare(
			"INSERT INTO candidate_workspace_claims(id,sessionId,identityId,userId,projectId,createdAt) VALUES(1,'session','identity','owner','project',0)",
		),
		env.DB.prepare(
			"INSERT INTO workspace_sessions(id,projectId,userId,title,status,branchName,sandboxIdentityId,runtimeOwner,runtimeOwnerVersion,runtimeProtocolVersion) VALUES('session','project','owner','t','active',?,'identity','pi_durable_v1',1,2)",
		).bind(branch),
		env.DB.prepare(
			"INSERT INTO sandbox_identities(id,kind,sandboxId,containerId,userId,projectId,workspaceSessionId,state,controllerClass,controllerNamespace,incarnationId) VALUES('identity','workspace_session','identity','identity','owner','project','session','ready','Sandbox','fixture-pi-durable-execution-v1','incarnation')",
		),
		env.DB.prepare(
			"INSERT INTO archives(id,ownerKind,ownerId,objectKey,formatVersion,compatibilityKey,byteCount,extractedBytes,digest,generation,status) VALUES('archive','project_seed',?,?,?,?,123,?,?,0,?)",
		).bind(
			options.archiveOwner ?? "project",
			OBJECT_KEY,
			ARCHIVE_FORMAT_VERSION,
			options.compatibilityKey ?? ARCHIVE_COMPATIBILITY_KEY,
			options.extractedBytes === undefined ? 456 : options.extractedBytes,
			DIGEST,
			options.archiveStatus ?? "ready",
		),
		env.DB.prepare(
			"INSERT INTO project_seeds(id,projectId,sourceCommit,archiveId,formatVersion,compatibilityKey,buildState) VALUES('seed','project',?,'archive',?,'seed-format=1;repo=acme/app',?)",
		).bind(COMMIT, ARCHIVE_FORMAT_VERSION, options.buildState ?? "ready"),
	]);
}

beforeEach(async () => {
	for (const key of Object.keys(migrations).sort())
		for (const statement of (migrations[key] ?? "").split(
			"--> statement-breakpoint",
		))
			if (statement.trim())
				await env.DB.exec(
					statement.replace(/^\s*--[^\n]*$/gm, "").replaceAll("\n", " "),
				);
});

const read = (who: CandidateFetchScope = scope) =>
	readCandidateBaselineSource(env.DB, who);

describe("readCandidateBaselineSource", () => {
	it("returns the owned branch and the measured seed with the archive format key", async () => {
		await seed();
		const result = await read();
		expect(result).toEqual({
			branch: "ditto/session",
			seed: {
				version: 1,
				kind: "workspace_archive",
				formatVersion: ARCHIVE_FORMAT_VERSION,
				compatibilityKey: ARCHIVE_COMPATIBILITY_KEY,
				objectKey: OBJECT_KEY,
				byteCount: 123,
				extractedBytes: 456,
				digest: DIGEST,
				sourceCommit: COMMIT,
			},
		});
		const text = JSON.stringify(result);
		expect(text).not.toContain(String(INSTALLATION));
		expect(text).not.toContain("seed-format");
		expect(text.toLowerCase()).not.toContain("token");
	});

	it("denies a caller that does not own a current session", async () => {
		await seed();
		expect(await read({ ...scope, userId: "intruder" })).toEqual({
			denied: "not_owned",
		});
		expect(await read({ ...scope, ownerVersion: 2 })).toEqual({
			denied: "not_owned",
		});
		await env.DB.exec(
			"UPDATE sandbox_identities SET state='retired',retiredAt=1 WHERE id='identity'",
		);
		expect(await read()).toEqual({ denied: "not_owned" });
	});

	it("denies a continuation destination", async () => {
		await seed();
		await env.DB.exec(
			"INSERT INTO candidate_continuations(id,userId,projectId,sourceSessionId,idempotencyKey,destinationSessionId,destinationIdentityId,sourcePairId,branchName,state,createdAt) VALUES('c','owner','project','src','k','session','dest-identity','pair','ditto/session','pending',0)",
		);
		expect(await read()).toEqual({ denied: "continuation_unsupported" });
	});

	it("denies a session with no owned branch", async () => {
		await seed({ branch: null });
		expect(await read()).toEqual({ denied: "branch_missing" });
	});

	it.each([
		["a pending seed", { buildState: "pending" }],
		["a failed seed", { buildState: "failed" }],
		["an abandoned archive", { archiveStatus: "abandoned" }],
		["an archive owned by another project", { archiveOwner: "other" }],
	])("reports no seed for %s", async (_name, options) => {
		await seed(options);
		expect(await read()).toEqual({ denied: "seed_unavailable" });
	});

	it("reports an unmeasured seed", async () => {
		await seed({ extractedBytes: null });
		expect(await read()).toEqual({ denied: "seed_unmeasured" });
	});

	it("reports an incompatible seed", async () => {
		await seed({ compatibilityKey: "other-format" });
		expect(await read()).toEqual({ denied: "seed_incompatible" });
	});
});
