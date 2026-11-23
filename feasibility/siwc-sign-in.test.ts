import { mkdtemp, readFile, stat } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { siwcCredentials } from "./chatgpt-sign-in.ts";
import { formatEvidence, runModelTrial } from "./model-trial.ts";
import {
	accessToken,
	EMAIL,
	refreshToken,
	SIWC_CLIENT_ID,
	signingKey,
	simulatedProvider,
} from "./simulated-provider.ts";

/** What the owner's browser does after consent: OpenAI redirects it to the loopback callback. */
function browserReturns(authorizeUrl: string, code = "code-SIMULATED") {
	const state = new URL(authorizeUrl).searchParams.get("state") ?? "";
	const callback = `http://127.0.0.1:1455/auth/callback?code=${code}&state=${state}&client_id=${SIWC_CLIENT_ID}&scope=${encodeURIComponent("openid chatgpt.tokens.use.direct")}`;
	return new Promise<number>((resolve, reject) => {
		get(callback, (response) => {
			response.resume();
			resolve(response.statusCode ?? 0);
		}).on("error", reject);
	});
}

async function signIn(options: { nonce?: (sent: string) => string } = {}) {
	const dir = await mkdtemp(path.join(tmpdir(), "ditto-siwc-"));
	const authFile = path.join(dir, "siwc.json");
	const hostIdFile = path.join(dir, "siwc-host-id");
	const key = await signingKey();
	let authorizeUrl = "";
	const provider = simulatedProvider({
		signIn: {
			sign: key.sign,
			jwks: key.jwks,
			nonce: () => {
				const sent = new URL(authorizeUrl).searchParams.get("nonce") ?? "";
				return options.nonce ? options.nonce(sent) : sent;
			},
		},
	});
	let opened: () => void = () => {};
	const waitForUrl = new Promise<void>((resolve) => (opened = resolve));
	const pending = siwcCredentials({
		authFile,
		hostIdFile,
		log: () => {},
		fetch: provider.fetch,
		openUrl: (url) => {
			authorizeUrl = url;
			opened();
		},
		// The owner never pastes the callback URL: the loopback listener receives it.
		ask: (_message, signal) =>
			new Promise((_resolve, reject) =>
				signal.addEventListener("abort", () => reject(signal.reason)),
			),
	});
	await waitForUrl;
	const status = await browserReturns(authorizeUrl);
	return { pending, authorizeUrl, status, authFile, hostIdFile, provider };
}

describe("local Sign in with ChatGPT (#34)", () => {
	it("registers with a stable host ID and asks for plan usage on api.openai.com", async () => {
		const { pending, authorizeUrl, hostIdFile } = await signIn();
		await pending;

		const sent = new URL(authorizeUrl);
		expect(`${sent.origin}${sent.pathname}`).toBe("https://auth.openai.com/api/accounts/authorize");
		const params = Object.fromEntries(sent.searchParams);
		expect(params).toMatchObject({
			client_id: "dynamic_agent_client",
			agent_name_hint: "Ditto",
			response_type: "code",
			redirect_uri: "http://127.0.0.1:1455/auth/callback",
			resource: "https://api.openai.com/v1",
			scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
			code_challenge_method: "S256",
		});
		const hostId = (await readFile(hostIdFile, "utf8")).trim();
		expect(params.ext_agent_host_id).toBe(`urn:uuid:${hostId}`);
		expect((await stat(hostIdFile)).mode & 0o777).toBe(0o600);
	}, 20_000);

	it("validates the ID token, saves the issued client and reports the grant", async () => {
		const { pending, authFile, status } = await signIn();
		const { signIn: result } = await pending;

		expect(status).toBe(200);
		expect(result).toMatchObject({
			idToken: { ok: true, failures: [] },
			expiresIn: 3600,
			grantedScopes: [
				"openid",
				"profile",
				"email",
				"offline_access",
				"resource.invoke",
				"chatgpt.tokens.use.direct",
			],
		});
		const saved = JSON.parse(await readFile(authFile, "utf8"));
		expect(saved.openai).toMatchObject({ type: "oauth", clientId: SIWC_CLIENT_ID });
		expect((await stat(authFile)).mode & 0o777).toBe(0o600);
	}, 20_000);

	it("reuses the saved sign-in and host ID instead of signing in again", async () => {
		const first = await signIn();
		await first.pending;
		const hostId = await readFile(first.hostIdFile, "utf8");

		const again = await siwcCredentials({
			authFile: first.authFile,
			hostIdFile: first.hostIdFile,
			log: () => {},
			openUrl: () => {
				throw new Error("asked the owner to sign in again");
			},
		});

		expect(again.signIn).toBeUndefined();
		expect(await again.store.read("openai")).toMatchObject({ clientId: SIWC_CLIENT_ID });
		expect(await readFile(first.hostIdFile, "utf8")).toBe(hostId);
	}, 20_000);

	it("refuses an ID token issued for a different sign-in attempt, and saves nothing", async () => {
		const { pending, authFile } = await signIn({ nonce: () => "someone-elses-nonce" });

		await expect(pending).rejects.toThrow(/ID token failed: nonce/);
		await expect(readFile(authFile, "utf8")).rejects.toThrow(/ENOENT/);
	}, 20_000);

	it("puts the sign-in in the trial's evidence entry, redacted", async () => {
		const { pending, provider } = await signIn();
		const { store, signIn: result } = await pending;
		const run = await runModelTrial({ route: "siwc", credentials: store, fetch: provider.fetch });

		const entry = formatEvidence([run], { origin: "home network", signIn: result });
		expect(entry).toMatch(
			/- \*\*Sign-in:\*\* authorization code with PKCE on the 127\.0\.0\.1:1455 loopback, a `urn:uuid` host ID, issued client `<clientId>`\. Granted scope `openid profile email offline_access resource\.invoke chatgpt\.tokens\.use\.direct`, access token expires_in 3600s, refresh token lifetime not in the token response, ID token valid 3600s\. ID token signature, iss, aud, exp and nonce checked: pass\. Token response fields: .*`id_token`/,
		);
		for (const secret of [SIWC_CLIENT_ID, EMAIL, accessToken(1), refreshToken(1)]) {
			expect(entry).not.toContain(secret);
		}
	}, 20_000);
});
