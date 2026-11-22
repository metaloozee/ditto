// The owner's ChatGPT sign-in, kept in a file outside the repo. Shared by the local baseline (#25)
// and the free-tier probe (#30), which keep separate files so neither retires the other's refresh token.
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
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";

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
