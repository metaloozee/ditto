import type { ConfigurationSelectionV1 } from "../../../../packages/runtime-contracts/src/configuration.js";
import {
	type AccountModel,
	type AccountSnapshot,
	CODEX_PROVIDER,
	MODEL_ID_PATTERN_V2,
	type ModelThinkingV2,
	modelProviderFor,
	parseAccountSnapshot,
} from "../../../../packages/runtime-contracts/src/model.js";
import { CODEX_BACKEND_URL, CODEX_CLIENT_VERSION } from "./codex-responses";

export const CODEX_MODELS_TTL_MS = 15 * 60 * 1000;

const SNAPSHOT_CHARACTERS = 4096;
const MAX_MODELS = 16;
const MAX_LISTED = 256;
const CANONICAL_THINKING: readonly ModelThinkingV2[] = [
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];
const encoder = new TextEncoder();

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function buildCodexModelsRequest(accountId: string): {
	url: string;
	init: {
		method: "GET";
		redirect: "manual";
		headers: Record<string, string>;
	};
} {
	return {
		url: `${CODEX_BACKEND_URL}/codex/models?client_version=${CODEX_CLIENT_VERSION}`,
		init: {
			method: "GET",
			redirect: "manual",
			headers: {
				accept: "application/json",
				"openai-beta": "responses=experimental",
				originator: "codex_cli_rs",
				"chatgpt-account-id": accountId,
			},
		},
	};
}

export function parseCodexModels(body: unknown): AccountModel[] | null {
	const root = record(body);
	if (!root || !Array.isArray(root.models) || root.models.length > MAX_LISTED)
		return null;
	const taken = new Set<string>();
	const models: AccountModel[] = [];
	for (const entry of root.models) {
		if (models.length >= MAX_MODELS) break;
		const m = record(entry);
		if (!m || m.visibility !== "list") continue;
		const slug = m.slug;
		if (
			typeof slug !== "string" ||
			slug.length === 0 ||
			encoder.encode(slug).byteLength > 128 ||
			!MODEL_ID_PATTERN_V2.test(slug) ||
			modelProviderFor(slug) !== CODEX_PROVIDER ||
			taken.has(slug)
		)
			continue;
		const efforts = new Set<unknown>(
			Array.isArray(m.supported_reasoning_levels)
				? m.supported_reasoning_levels.map((level) => record(level)?.effort)
				: [],
		);
		const thinking = CANONICAL_THINKING.filter((level) => efforts.has(level));
		if (thinking.length === 0) continue;
		const first = thinking.find((level) => level === m.default_reasoning_level);
		taken.add(slug);
		models.push({
			id: slug,
			thinking: first
				? [first, ...thinking.filter((level) => level !== first)]
				: thinking,
		});
	}
	return models;
}

function snapshotOf(
	generation: number,
	revision: number,
	models: AccountModel[],
): { snapshot: string; kept: AccountModel[] } {
	const kept = [...models];
	for (;;) {
		const snapshot = JSON.stringify({
			version: 2,
			status: kept.length ? "available" : "unavailable",
			generation,
			revision,
			models: kept,
		});
		if (snapshot.length <= SNAPSHOT_CHARACTERS || kept.length === 0)
			return { snapshot, kept };
		kept.pop();
	}
}

export function buildAccountSnapshot(
	generation: number,
	revision: number,
	models: AccountModel[],
): string {
	return snapshotOf(generation, revision, models).snapshot;
}

type SnapshotRow = { generation: number; revision: number; snapshot: string };

export async function writeAccountSnapshot(
	db: D1Database,
	owner: string,
	generation: number,
	models: AccountModel[],
): Promise<"written" | "unchanged" | "stale"> {
	const prior = await db
		.prepare(
			"SELECT generation,revision,snapshot FROM codex_fixture_capabilities WHERE userId=?",
		)
		.bind(owner)
		.first<SnapshotRow>();
	const sameGeneration = prior?.generation === generation;
	const revision = prior && sameGeneration ? prior.revision + 1 : 1;
	const { snapshot, kept } = snapshotOf(generation, revision, models);
	if (prior && sameGeneration) {
		try {
			const parsed = parseAccountSnapshot(prior.snapshot);
			if (
				parsed.version === 2 &&
				JSON.stringify(parsed.models) === JSON.stringify(kept)
			)
				return "unchanged";
		} catch {
			// An unreadable prior snapshot is replaced below.
		}
	}
	const result = await db
		.prepare(
			`INSERT INTO codex_fixture_capabilities(userId,generation,revision,snapshot)
SELECT ?,?,?,? FROM codex_connections k
WHERE k.user_id=? AND k.generation=? AND k.revoked=0 AND k.status='connected'
ON CONFLICT(userId) DO UPDATE SET generation=excluded.generation,revision=excluded.revision,snapshot=excluded.snapshot
WHERE codex_fixture_capabilities.generation=? AND codex_fixture_capabilities.revision=?`,
		)
		.bind(
			owner,
			generation,
			revision,
			snapshot,
			owner,
			generation,
			prior?.generation ?? 0,
			prior?.revision ?? 0,
		)
		.run();
	return result.meta.changes === 1 ? "written" : "stale";
}

export function defaultSelectionFrom(
	snapshot: AccountSnapshot,
): ConfigurationSelectionV1 | null {
	if (snapshot.status !== "available") return null;
	const model = snapshot.models[0];
	return model ? { model: model.id, thinking: model.thinking[0] } : null;
}
