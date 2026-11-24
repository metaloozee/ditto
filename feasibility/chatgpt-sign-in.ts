// The owner's ChatGPT sign-ins, kept in files outside the repo. Each stage keeps its own file, so
// no stage retires another's refresh token. `chatgptCredentials` signs in to the Codex backend
// (#25, #26, #30, #31). `siwcCredentials` signs in with ChatGPT for plan usage on api.openai.com (#34).
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";

import {
	type AuthInteraction,
	type Credential,
	type CredentialStore,
	createModels,
	InMemoryCredentialStore,
} from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";

import { ISSUER, validateIdToken } from "./id-token.ts";
import type { SiwcSignIn } from "./model-trial.ts";

class FileCredentialStore extends InMemoryCredentialStore {
	private file: string;
	constructor(file: string) {
		super();
		this.file = file;
	}
	async load() {
		const saved = await readFile(this.file, "utf8").catch(() => undefined);
		if (!saved) return;
		for (const [id, credential] of Object.entries(
			JSON.parse(saved) as Record<string, Credential>,
		)) {
			await super.modify(id, async () => credential);
		}
	}
	override async modify(...args: Parameters<CredentialStore["modify"]>) {
		const result = await super.modify(...args);
		await this.save();
		return result;
	}
	private async save() {
		const all: Record<string, Credential> = {};
		for (const { providerId } of await this.list()) {
			const credential = await this.read(providerId);
			if (credential) all[providerId] = credential;
		}
		await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
		await writeFile(this.file, JSON.stringify(all), { mode: 0o600 });
		await chmod(this.file, 0o600);
	}
}

/** Loads the sign-in from `authFile`, or runs a device-code sign-in and saves it there. */
export async function chatgptCredentials(
	authFile: string,
	log: (message: string) => void,
): Promise<CredentialStore> {
	const store = new FileCredentialStore(authFile);
	await store.load();
	if (await store.read("openai-codex")) return store;

	log(`No ChatGPT sign-in at ${authFile}. Starting device-code sign-in.`);
	const terminal = createInterface({ input: process.stdin, output: process.stderr });
	const interaction: AuthInteraction = {
		async prompt(prompt) {
			if (prompt.type === "select") return "device_code";
			return terminal.question(`${prompt.message} `);
		},
		notify(event) {
			if (event.type === "device_code") {
				log(`Open ${event.verificationUri} and enter code ${event.userCode}`);
			} else if (event.type === "auth_url") {
				log(`Open ${event.url}`);
			} else {
				log(event.message);
			}
		},
	};
	const models = createModels({ credentials: store });
	models.setProvider(openaiCodexProvider());
	try {
		await models.login("openai-codex", "oauth", interaction);
	} finally {
		terminal.close();
	}
	log("Signed in.");
	return store;
}

async function writePrivate(file: string, contents: string) {
	await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
	await writeFile(file, contents, { mode: 0o600 });
	await chmod(file, 0o600);
}

/** This machine's agent host ID: created once, then the same on every sign-in (OpenAI's docs). */
async function hostId(file: string): Promise<string> {
	const saved = (await readFile(file, "utf8").catch(() => "")).trim();
	if (saved) return saved;
	const id = randomUUID();
	await writePrivate(file, id);
	return id;
}

export interface SiwcSignInOptions {
	/** The sign-in, saved only once its ID token passes every check. */
	authFile: string;
	/** This host's `ext_agent_host_id`, a UUID kept apart from the sign-in. */
	hostIdFile: string;
	log: (message: string) => void;
	/** The network. Defaults to the global fetch; tests pass a simulated provider. */
	fetch?: typeof fetch;
	/** Shows the owner the authorize URL. Defaults to logging it. */
	openUrl?: (url: string) => void;
	/** Asks for a pasted callback URL, if the loopback listener never receives one. */
	ask?: (message: string, signal: AbortSignal) => Promise<string>;
}

/**
 * Loads the Sign in with ChatGPT credential from `authFile`, or signs in through Pi's
 * loopback flow (PKCE, `127.0.0.1:1455`) and saves it there. A fresh sign-in also returns
 * what the evidence entry records: the grant, the token lifetime and the ID token checks.
 */
export async function siwcCredentials(
	options: SiwcSignInOptions,
): Promise<{ store: CredentialStore; signIn?: SiwcSignIn }> {
	const store = new FileCredentialStore(options.authFile);
	await store.load();
	if (await store.read("openai")) return { store };

	const network = options.fetch ?? globalThis.fetch;
	const host = await hostId(options.hostIdFile);
	options.log(
		`No Sign in with ChatGPT at ${options.authFile}. Signing in as host urn:uuid:${host}.`,
	);
	let nonce = "";
	const tokenResponses: Record<string, unknown>[] = [];
	const terminal = options.ask
		? undefined
		: createInterface({ input: process.stdin, output: process.stderr });
	const ask =
		options.ask ??
		((message: string, signal: AbortSignal) => terminal!.question(`${message} `, { signal }));
	const interaction: AuthInteraction = {
		prompt: (prompt) => ask(prompt.message, prompt.signal ?? new AbortController().signal),
		notify(event) {
			if (event.type === "auth_url") {
				nonce = new URL(event.url).searchParams.get("nonce") ?? "";
				(options.openUrl ?? ((url) => options.log(`Open ${url}`)))(event.url);
			} else if (event.type !== "device_code") {
				options.log(event.message);
			}
		},
	};

	// Pi keeps only the access and refresh tokens, so read the ID token and grant off the wire.
	const original = globalThis.fetch;
	globalThis.fetch = async (request, init) => {
		const response = await network(request, init);
		const url = request instanceof Request ? request.url : String(request);
		if (url.endsWith("/oauth/token") && response.ok) {
			const body: unknown = await response.clone().json();
			if (body && typeof body === "object") tokenResponses.push(body as Record<string, unknown>);
		}
		return response;
	};
	const pending = new InMemoryCredentialStore();
	try {
		const models = createModels({ credentials: pending });
		models.setProvider(openaiProvider());
		await models.login("openai", "oauth", interaction, {
			getDeviceId: () => host,
			agentName: "Ditto",
		});
	} finally {
		globalThis.fetch = original;
		terminal?.close();
	}

	const credential = await pending.read("openai");
	const token = tokenResponses.at(-1);
	if (credential?.type !== "oauth" || !token) throw new Error("Sign-in returned no credential");
	const clientId = String(credential.clientId);
	const discovery: unknown = await (
		await network(`${ISSUER}/.well-known/openid-configuration`)
	).json();
	const jwksUri =
		discovery && typeof discovery === "object" ? Reflect.get(discovery, "jwks_uri") : undefined;
	if (typeof jwksUri !== "string") throw new Error("OpenAI's discovery document has no jwks_uri");
	const jwks: unknown = await (await network(jwksUri)).json();
	const idToken = await validateIdToken(String(token.id_token), { clientId, nonce, jwks });
	if (!idToken.ok) throw new Error(`ID token failed: ${idToken.failures.join(", ")}`);

	await store.modify("openai", async () => credential);
	options.log("Signed in. The ID token passed every check.");
	return {
		store,
		signIn: {
			clientId,
			grantedScopes: String(token.scope).split(/\s+/).filter(Boolean),
			expiresIn: Number(token.expires_in),
			refreshExpiresIn: [token.refresh_token_expires_in, token.refresh_expires_in].find(
				(value): value is number => typeof value === "number",
			),
			idTokenSeconds: idTokenLifetime(String(token.id_token)),
			tokenFields: Object.keys(token),
			idToken,
		},
	};
}

function idTokenLifetime(token: string): number | undefined {
	const [iat, exp] = ["iat", "exp"].map((claim) => {
		try {
			const payload = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "";
			const value: unknown = Reflect.get(JSON.parse(atob(payload)), claim);
			return typeof value === "number" ? value : undefined;
		} catch {
			return undefined;
		}
	});
	return iat === undefined || exp === undefined ? undefined : exp - iat;
}
