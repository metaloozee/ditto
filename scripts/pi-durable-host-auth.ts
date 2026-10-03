import { readFile } from "node:fs/promises";
import { parse } from "dotenv";
import alchemy from "alchemy";

interface FixtureHostAuth {
	apiToken: string;
	accountId: string;
}

export async function loadFixtureHostAuth(file: unknown): Promise<FixtureHostAuth> {
	if (typeof file !== "string" || !file) {
		throw new Error("Explicit Cloudflare credential file path required");
	}
	let selected;
	try {
		const parsed = parse(await readFile(file));
		selected = {
			apiToken: parsed.CLOUDFLARE_API_TOKEN,
			accountId: parsed.CLOUDFLARE_ACCOUNT_ID,
		};
	} catch {
		throw new Error("Cannot read selected Cloudflare credential file");
	}
	if (!selected.apiToken || !/^[A-Za-z0-9_-]{20,}$/.test(selected.apiToken)) {
		throw new Error("Missing or invalid CLOUDFLARE_API_TOKEN");
	}
	if (!selected.accountId || !/^[a-fA-F0-9]{32}$/.test(selected.accountId)) {
		throw new Error("Missing or invalid CLOUDFLARE_ACCOUNT_ID");
	}
	return selected;
}

export function fixtureWorkerAuth(selected: FixtureHostAuth) {
	return {
		apiToken: alchemy.secret(selected.apiToken),
		accountId: selected.accountId,
	};
}

// Redact after collecting complete streams so chunk boundaries cannot split a value.
export function redactFixtureHostAuth(text: string, selected?: FixtureHostAuth) {
	if (!selected) return text;
	return [selected.apiToken, selected.accountId].reduce(
		(result, value) => result.replaceAll(value, "<REDACTED>"),
		text,
	);
}
