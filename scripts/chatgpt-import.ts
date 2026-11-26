// Signs in with ChatGPT on this machine, then imports the credential once into the signed-in
// owner's Credentials object on a Ditto deployment. The sign-in can't run in a Worker: its
// callback (127.0.0.1:1455) reaches only the browser's machine, as OpenAI's self-hosted guide says.
//   DITTO_COOKIE='<Cookie header of a signed-in Settings page>' pnpm chatgpt:import https://<deployment>
// The deployment owns the sign-in from then on, so no copy is kept here.
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { siwcCredentials } from "../feasibility/chatgpt-sign-in.ts";

const log = (message: string) => console.error(`[chatgpt-import] ${message}`);

const [deployment] = process.argv.slice(2);
const cookie = process.env.DITTO_COOKIE;
if (!deployment || !cookie) {
	log("Usage: DITTO_COOKIE='<session cookie>' pnpm chatgpt:import https://<deployment>");
	process.exit(2);
}

const scratch = await mkdtemp(path.join(tmpdir(), "ditto-chatgpt-"));
try {
	const { store } = await siwcCredentials({
		authFile: path.join(scratch, "sign-in.json"),
		// One agent host ID per machine, kept for every later sign-in, per OpenAI's docs.
		hostIdFile: path.join(homedir(), ".config", "ditto", "chatgpt-host-id"),
		log,
	});
	const response = await fetch(new URL("/api/models/chatgpt", deployment), {
		method: "POST",
		headers: { cookie, "content-type": "application/json" },
		body: JSON.stringify({ credential: await store.read("openai") }),
	});
	if (!response.ok) throw new Error(`The deployment refused the import: ${response.status}`);
	log("Imported. Settings shows the ChatGPT plan as Connected.");
} finally {
	await rm(scratch, { recursive: true, force: true });
}
