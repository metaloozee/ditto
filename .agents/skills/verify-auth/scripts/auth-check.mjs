#!/usr/bin/env node
// Drives Ditto's sign-up, sign-in, linking and session journeys in Chromium
// against an `auth.sh up` stage, as a user would, and proves each outcome on
// screen, in the fake inbox and in the stage's D1. Run it through auth.sh.
//
//   node auth-check.mjs [--only id,id] [--headed] [--list] [--out DIR]
//
// Exit 0 when every journey passes, 1 when any fails, 2 when the run itself broke.
import { randomInt, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const { chromium, devices } = createRequire(join(repo, "apps/web/package.json"))("playwright");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const APP = process.env.VERIFY_AUTH_URL ?? "http://localhost:1339";
const UPSTREAM = process.env.VERIFY_AUTH_UPSTREAM;
const D1 = process.env.VERIFY_AUTH_D1;
const SESSION_EXPIRES_IN = Number(process.env.VERIFY_AUTH_SESSION_EXPIRES_IN ?? 30);
const CODE_EXPIRES_IN = Number(process.env.VERIFY_AUTH_CODE_EXPIRES_IN ?? 10);
const CODE_RESEND_IN = Number(process.env.VERIFY_AUTH_CODE_RESEND_IN ?? 3);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = resolve(opt("out") ?? join(repo, ".scratch/verify-auth/runs", stamp));

// ---------------------------------------------------------------- harness

class Precondition extends Error {}

const db = () => {
	if (!D1) throw new Precondition("VERIFY_AUTH_D1 is unset: run through auth.sh after auth.sh up");
	return new DatabaseSync(D1, { readOnly: true });
};
/** Read-only rows from the stage's D1. */
function rows(sql, ...params) {
	const conn = db();
	try {
		return conn.prepare(sql).all(...params);
	} finally {
		conn.close();
	}
}
const userByEmail = (email) =>
	rows("select id, name, email, first_name, last_name from user where email = ?", email)[0] ?? null;
const methodsOf = (userId) =>
	rows("select provider_id from account where user_id = ? order by provider_id", userId).map(
		(r) => r.provider_id,
	);
const sessionCount = (userId) =>
	rows("select count(*) n from session where user_id = ?", userId)[0].n;

const up = (path, init) => fetch(`${UPSTREAM}${path}`, init);
/** Every email the Worker handed to fake Resend for `to`, oldest first. */
const inbox = async (to) => (await up(`/__emails?to=${encodeURIComponent(to)}`)).json();
async function latestCode(to) {
	const code = (await inbox(to)).at(-1)?.text.match(/\b(\d{6})\b/)?.[1];
	if (!code) throw new Error(`No code was emailed to ${to}`);
	return code;
}
const nextGitHub = (a) => up("/__github/next", { method: "POST", body: JSON.stringify(a) });
const nextGoogle = (a) => up("/__google/next", { method: "POST", body: JSON.stringify(a) });

const tag = () => `${Date.now().toString(36)}${randomInt(1000)}`;
const newAddress = () => `ada+${randomUUID()}@example.com`;
let nextId = 5_000_000 + randomInt(1_000_000);
function gitHubUser(overrides = {}) {
	const id = nextId++;
	const email = `octo${id}@example.com`;
	return {
		id,
		login: `octo${id}`,
		name: `Octo Cat ${id}`,
		email,
		emails: [{ email, primary: true, verified: true }],
		...overrides,
	};
}
function googleUser(overrides = {}) {
	const sub = String(nextId++);
	return {
		sub,
		email: `goog${sub}@example.com`,
		email_verified: true,
		name: `Gina Google ${sub}`,
		given_name: "Gina",
		family_name: `Google ${sub}`,
		...overrides,
	};
}

let browser;

/** One journey's handle: fresh browsers, evidence and assertions. */
function journey(id) {
	const dir = join(OUT, id);
	mkdirSync(dir, { recursive: true });
	const facts = [];
	const pages = [];
	let shots = 0;
	const t = {
		dir,
		facts,
		/** A fresh browser — own cookies and client address, like a separate device. */
		async visitor(options = {}) {
			const context = await browser.newContext({
				baseURL: APP,
				viewport: { width: 1280, height: 900 },
				...options,
				extraHTTPHeaders: {
					"cf-connecting-ip": `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`,
				},
			});
			const page = await context.newPage();
			pages.push(page);
			return { context, page };
		},
		open: (page, path) => page.goto(path, { waitUntil: "networkidle" }),
		path: (page) => new URL(page.url()).pathname,
		async workspace(page) {
			await t.sees(page, "Hi, I’m Ditto, your Chief of Staff.");
		},
		async accountName(page, name) {
			await t.workspace(page);
			await page.getByRole("button", { name: "Account", exact: true }).click();
			const label = page.getByRole("menu").getByText(name, { exact: true });
			await label.waitFor();
			t.eq("Account menu shows the owner’s name", await label.innerText(), name);
			await page.keyboard.press("Escape");
		},
		/** Waits for text a user would read, such as a toast or an error line. */
		async sees(page, text, timeout = 10_000) {
			try {
				await page.getByText(text, { exact: true }).first().waitFor({ timeout });
			} catch {
				throw new Error(`expected to see "${text}" within ${timeout}ms; page is ${page.url()}`);
			}
		},
		async session(context) {
			return (await context.request.get("/api/auth/get-session")).json();
		},
		/** Screenshot plus ARIA snapshot of what the user sees now. */
		async proof(page, name) {
			const base = `${String(++shots).padStart(2, "0")}-${name}`;
			await page.screenshot({ path: join(dir, `${base}.png`) });
			writeFileSync(
				join(dir, `${base}.aria.yml`),
				`# ${page.url()}\n${await page.locator("body").ariaSnapshot()}\n`,
			);
		},
		/** Records a measured value; throws unless it equals `want`. */
		eq(label, got, want) {
			const pass = JSON.stringify(got) === JSON.stringify(want);
			facts.push({ label, got, want, pass });
			if (!pass) throw new Error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
		},
		/** Records an observed fact that has no single expected value. */
		saw(label, got) {
			facts.push({ label, got, pass: true });
		},
		async emails(to, label = "emails") {
			// Codes are test-only, but evidence never carries one.
			const redact = (v) => v?.replace(/\b\d{6}\b/g, "######");
			const mail = (await inbox(to)).map((e) => ({
				...e,
				subject: redact(e.subject),
				text: redact(e.text),
				html: undefined,
				attachments: e.attachments?.map((a) => a.filename),
			}));
			writeFileSync(join(dir, `${label}-${to.replace(/[^\w.@+-]/g, "_")}.json`), JSON.stringify(mail, null, "\t"));
			return mail;
		},
		async enterCode(page, code) {
			await page.getByLabel("Code").fill(code);
		},
		async signUpForm(page, details) {
			await t.open(page, "/sign-up");
			await page.getByLabel("First name").fill(details.firstName);
			await page.getByLabel("Last name").fill(details.lastName);
			await page.getByLabel("Email address").fill(details.email);
			await page.getByRole("button", { name: "Continue with email" }).click();
			await page.getByRole("heading", { name: "Check your email" }).waitFor();
		},
		async signUpByEmail(page, details) {
			await t.signUpForm(page, details);
			await t.enterCode(page, await latestCode(details.email));
			await t.workspace(page);
		},
		async requestSignIn(page, email) {
			await t.open(page, "/sign-in");
			await page.getByLabel("Email address").fill(email);
			await page.getByRole("button", { name: "Continue with email" }).click();
			await page.getByRole("heading", { name: "Check your email" }).waitFor();
		},
		/** Leaves for the provider from `from` and waits for Ditto to handle the callback. */
		async continueWith(page, provider, authorization, from = "/sign-in") {
			await (provider === "GitHub" ? nextGitHub : nextGoogle)(authorization);
			await t.open(page, from);
			const landed = page.waitForEvent("load");
			await page.getByRole("button", { name: `Continue with ${provider}` }).click();
			await landed;
			await page.waitForLoadState("networkidle");
		},
		async link(page, method, authorization) {
			await t.open(page, "/settings");
			if (method === "GitHub") await nextGitHub(authorization);
			if (method === "Google") await nextGoogle(authorization);
			await page.getByRole("button", { name: `Link ${method}` }).click();
		},
		async signOut(page) {
			await page.getByRole("button", { name: "Account", exact: true }).click();
			await page.getByRole("menuitem", { name: "Sign out" }).click();
			await page.waitForURL((url) => url.pathname === "/sign-in");
		},
		async close() {
			for (const p of pages) await p.context().close().catch(() => {});
		},
		pages,
	};
	return t;
}

// ---------------------------------------------------------------- journeys

const names = { firstName: "Ada", lastName: "Lovelace" };
const J = {};

// --- email sign-up

J["signup-email"] = {
	feature: "email-sign-up",
	async run(t) {
		const email = newAddress();
		const { page } = await t.visitor();
		await t.signUpForm(page, { ...names, email });
		await t.proof(page, "code-step");
		t.eq("no user row before the code is verified", userByEmail(email), null);
		const [mail] = await t.emails(email);
		t.eq("one email to the address", (await inbox(email)).length, 1);
		t.eq("from the Ditto sender", mail.from, "Ditto <sign-in@test.example>");
		t.eq("subject carries the code", mail.subject, "###### is your Ditto code");
		t.eq("body states the expiry", mail.text.includes(`It expires in ${CODE_EXPIRES_IN} seconds.`), true);
		await t.enterCode(page, await latestCode(email));
		await t.workspace(page);
		await t.proof(page, "home");
		await t.accountName(page, "Ada Lovelace");
		const user = userByEmail(email);
		t.eq("D1 user names", [user?.name, user?.first_name, user?.last_name], ["Ada Lovelace", "Ada", "Lovelace"]);
		t.eq("D1 sign-in methods", methodsOf(user.id), ["email"]);
		t.eq("D1 sessions", sessionCount(user.id), 1);
	},
};

J["signup-change-email"] = {
	feature: "email-sign-up",
	async run(t) {
		const typo = newAddress();
		const fixed = newAddress();
		const { page } = await t.visitor();
		await t.signUpForm(page, { ...names, email: typo });
		await page.getByRole("button", { name: "Use a different email" }).click();
		await t.proof(page, "form-again");
		t.eq("first name is kept", await page.getByLabel("First name").inputValue(), names.firstName);
		t.eq("last name is kept", await page.getByLabel("Last name").inputValue(), names.lastName);
		await page.getByLabel("Email address").fill(fixed);
		await page.getByRole("button", { name: "Continue with email" }).click();
		await t.sees(page, fixed);
		await t.enterCode(page, await latestCode(fixed));
		await t.workspace(page);
		await t.proof(page, "home");
		t.eq("D1 account under the corrected address", userByEmail(fixed)?.email, fixed);
		t.eq("D1 has no account for the mistyped address", userByEmail(typo), null);
	},
};

J["signup-existing"] = {
	feature: "email-sign-up",
	async run(t) {
		const email = newAddress();
		const first = await t.visitor();
		await t.signUpByEmail(first.page, { ...names, email });
		const again = await t.visitor();
		await t.signUpForm(again.page, { firstName: "Someone", lastName: "Else", email });
		await t.enterCode(again.page, await latestCode(email));
		await t.sees(again.page, "You already have a Ditto account");
		await t.proof(again.page, "sent-to-sign-in");
		t.eq("lands on", t.path(again.page), "/sign-in");
		t.eq("no session for the repeat", await t.session(again.context), null);
		const user = userByEmail(email);
		t.eq("D1 profile unchanged", [user.first_name, user.last_name], ["Ada", "Lovelace"]);
		t.eq("D1 still one user for the address", rows("select count(*) n from user where email = ?", email)[0].n, 1);
	},
};

// --- email sign-in and codes

J["signin-email"] = {
	feature: "email-sign-in",
	async run(t) {
		const email = newAddress();
		const owner = await t.visitor();
		await t.signUpByEmail(owner.page, { ...names, email });
		const id = userByEmail(email).id;
		const laptop = await t.visitor();
		await t.requestSignIn(laptop.page, email);
		await t.proof(laptop.page, "code-step");
		const code = await latestCode(email);
		await t.enterCode(laptop.page, code);
		await t.accountName(laptop.page, "Ada Lovelace");
		await t.proof(laptop.page, "home");
		t.eq("same Ditto account", (await t.session(laptop.context))?.user.id, id);
		t.eq("D1 sessions (sign-up + sign-in)", sessionCount(id), 2);
		const replay = await t.visitor();
		await t.requestSignIn(replay.page, email);
		await t.enterCode(replay.page, code);
		await t.sees(replay.page, "That code didn’t work. Check it or request a new one.");
		await t.proof(replay.page, "used-code-rejected");
		t.eq("a used code opens no session", await t.session(replay.context), null);
	},
};

J["signin-unknown"] = {
	feature: "email-sign-in",
	async run(t) {
		const unknown = newAddress();
		const github = gitHubUser();
		const owner = await t.visitor();
		await t.continueWith(owner.page, "GitHub", github);
		const a = await t.visitor();
		await t.requestSignIn(a.page, unknown);
		await t.proof(a.page, "unknown-ack");
		const b = await t.visitor();
		await t.requestSignIn(b.page, github.email);
		await t.proof(b.page, "github-only-ack");
		const text = async (page, email) =>
			(await page.getByText(email, { exact: true }).locator("..").innerText()).replace(email, "<email>");
		t.eq("same acknowledgement for unknown and email-disabled", await text(a.page, unknown), await text(b.page, github.email));
		await sleep(1000);
		t.eq("no mail to the unknown address", (await inbox(unknown)).length, 0);
		t.eq("no mail to the GitHub-only address", (await inbox(github.email)).length, 0);
		await t.enterCode(a.page, "123456");
		await t.sees(a.page, "That code didn’t work. Check it or request a new one.");
		t.eq("no session", await t.session(a.context), null);
		t.eq("D1 has no account for the unknown address", userByEmail(unknown), null);
	},
};

J["code-wrong"] = {
	feature: "email-sign-in",
	async run(t) {
		const email = newAddress();
		const { page } = await t.visitor();
		await t.signUpForm(page, { ...names, email });
		const code = await latestCode(email);
		const wrong = code === "000000" ? "111111" : "000000";
		await t.enterCode(page, wrong);
		await t.sees(page, "That code isn’t right. 2 tries left.");
		await t.enterCode(page, wrong);
		await t.sees(page, "That code isn’t right. 1 try left.");
		await t.enterCode(page, wrong);
		await t.sees(page, "Too many incorrect codes. Send a new one to continue.");
		await t.proof(page, "locked");
		t.eq("D1 has no account", userByEmail(email), null);
		t.eq("no session", await t.session(page.context()), null);
	},
};

J["code-resend"] = {
	feature: "email-sign-in",
	async run(t) {
		const email = newAddress();
		const { page } = await t.visitor();
		await t.signUpForm(page, { ...names, email });
		const old = await latestCode(email);
		await t.proof(page, "resend-wait");
		await page.getByRole("button", { name: "Send a new code" }).click({ timeout: (CODE_RESEND_IN + 3) * 1000 });
		await t.sees(page, "New code sent");
		await t.proof(page, "resent");
		t.eq("two emails", (await t.emails(email)).length, 2);
		const fresh = await latestCode(email);
		if (fresh !== old) {
			await t.enterCode(page, old);
			await t.sees(page, "That code isn’t right. 2 tries left.");
			t.saw("replaced code rejected", true);
		}
		await t.enterCode(page, fresh);
		await t.workspace(page);
		t.eq("D1 account created by the new code", userByEmail(email)?.email, email);
	},
};

J["code-expired"] = {
	feature: "email-sign-in",
	async run(t) {
		const email = newAddress();
		const { page } = await t.visitor();
		await t.signUpForm(page, { ...names, email });
		const code = await latestCode(email);
		await sleep((CODE_EXPIRES_IN + 1) * 1000);
		await t.enterCode(page, code);
		await t.sees(page, "This code has expired. Send a new one to continue.");
		await t.proof(page, "expired");
		t.eq("D1 has no account", userByEmail(email), null);
	},
};

// --- GitHub and Google

J["github-signup"] = {
	feature: "oauth",
	async run(t) {
		const github = gitHubUser();
		const { page } = await t.visitor();
		await t.continueWith(page, "GitHub", github);
		await t.proof(page, "home");
		await t.accountName(page, github.name);
		const user = userByEmail(github.email);
		t.eq("D1 name from GitHub, no split", [user?.name, user?.first_name, user?.last_name], [github.name, null, null]);
		t.eq("D1 methods", methodsOf(user.id), ["github"]);
		t.eq("D1 account id is the GitHub id", rows("select account_id from account where user_id = ?", user.id)[0].account_id, String(github.id));
		const back = await t.visitor();
		await t.continueWith(back.page, "GitHub", { ...github, email: `moved${github.id}@example.com`, emails: [{ email: `moved${github.id}@example.com`, primary: true, verified: true }] });
		await t.proof(back.page, "returning-after-email-change");
		t.eq("returning identity reaches the same account", (await t.session(back.context))?.user.id, user.id);
		t.eq("Ditto email unchanged", userByEmail(github.email)?.id, user.id);
	},
};

J["github-private-email"] = {
	feature: "oauth",
	async run(t) {
		const email = `private${nextId}@example.com`;
		const github = gitHubUser({ email: null, emails: [{ email, primary: true, verified: true }] });
		const { page } = await t.visitor();
		await t.continueWith(page, "GitHub", github);
		await t.proof(page, "home");
		t.eq("D1 account uses the verified private address", userByEmail(email)?.name, github.name);
	},
};

J["github-no-name"] = {
	feature: "oauth",
	async run(t) {
		const github = gitHubUser({ name: null });
		const { page } = await t.visitor();
		await t.continueWith(page, "GitHub", github);
		await t.proof(page, "home");
		await t.accountName(page, github.login);
	},
};

J["github-cancel"] = {
	feature: "oauth",
	async run(t) {
		const { page } = await t.visitor();
		await t.continueWith(page, "GitHub", { cancel: true });
		await t.sees(page, "GitHub sign-in was cancelled");
		await t.proof(page, "cancelled");
		t.eq("back on", t.path(page), "/sign-in");
		t.eq("no session", await t.session(page.context()), null);
	},
};

J["google-signup"] = {
	feature: "oauth",
	async run(t) {
		const google = googleUser();
		const { page } = await t.visitor();
		await t.continueWith(page, "Google", google, "/sign-up");
		await t.proof(page, "home");
		await t.accountName(page, google.name);
		const user = userByEmail(google.email);
		t.eq("D1 keeps Google's names", [user?.name, user?.first_name, user?.last_name], [google.name, google.given_name, google.family_name]);
		t.eq("D1 methods", methodsOf(user.id), ["google"]);
		const back = await t.visitor();
		await t.continueWith(back.page, "Google", google);
		t.eq("returning Google user, same account", (await t.session(back.context))?.user.id, user.id);
		const cancel = await t.visitor();
		await t.continueWith(cancel.page, "Google", { cancel: true });
		await t.sees(cancel.page, "Google sign-in was cancelled");
		await t.proof(cancel.page, "cancelled");
	},
};

J["oauth-other-method"] = {
	feature: "oauth",
	async run(t) {
		const github = gitHubUser();
		const owner = await t.visitor();
		await t.continueWith(owner.page, "GitHub", github);
		const id = userByEmail(github.email).id;
		const visitor = await t.visitor();
		await t.continueWith(visitor.page, "Google", googleUser({ email: github.email }));
		await t.sees(visitor.page, "This account uses another sign-in method");
		await t.proof(visitor.page, "other-method");
		t.eq("lands on", t.path(visitor.page), "/sign-in");
		t.eq("no session", await t.session(visitor.context), null);
		t.eq("D1 no Google link created", methodsOf(id), ["github"]);
	},
};

// --- linking in Settings

J["link-google"] = {
	feature: "linking",
	async run(t) {
		const github = gitHubUser();
		const google = googleUser({ email: github.email });
		const { page } = await t.visitor();
		await t.continueWith(page, "GitHub", github);
		await t.open(page, "/settings");
		await t.proof(page, "settings-before");
		await t.link(page, "Google", google);
		await t.sees(page, "Google is linked");
		await t.proof(page, "linked");
		const id = userByEmail(github.email).id;
		t.eq("D1 methods", methodsOf(id), ["github", "google"]);
		await t.open(page, "/settings");
		t.eq("Settings shows two Enabled", await page.getByText("Enabled", { exact: true }).count(), 2);
		const viaGoogle = await t.visitor();
		await t.continueWith(viaGoogle.page, "Google", google);
		t.eq("Google opens the same account", (await t.session(viaGoogle.context))?.user.id, id);
		await t.proof(viaGoogle.page, "home-via-google");
	},
};

J["link-github"] = {
	feature: "linking",
	async run(t) {
		const google = googleUser();
		const github = gitHubUser({ email: null, emails: [{ email: google.email, primary: true, verified: true }] });
		const { page } = await t.visitor();
		await t.continueWith(page, "Google", google);
		await t.link(page, "GitHub", github);
		await t.sees(page, "GitHub is linked");
		await t.proof(page, "linked");
		const id = userByEmail(google.email).id;
		t.eq("D1 methods", methodsOf(id), ["github", "google"]);
		const viaGitHub = await t.visitor();
		await t.continueWith(viaGitHub.page, "GitHub", github);
		await t.accountName(viaGitHub.page, google.name);
	},
};

J["link-email"] = {
	feature: "linking",
	async run(t) {
		const email = newAddress();
		const github = gitHubUser({ email, emails: [{ email, primary: true, verified: true }] });
		const owner = await t.visitor();
		await t.continueWith(owner.page, "GitHub", github);
		const id = userByEmail(email).id;
		const stranger = await t.visitor();
		await t.requestSignIn(stranger.page, email);
		await sleep(500);
		t.eq("before linking, sign-in sends no mail", (await inbox(email)).length, 0);
		await t.link(owner.page, "Email");
		await owner.page.getByRole("heading", { name: "Add email sign-in" }).waitFor();
		await t.proof(owner.page, "verify-email");
		const linkCode = await latestCode(email);
		await t.enterCode(stranger.page, linkCode);
		await t.sees(stranger.page, "That code didn’t work. Check it or request a new one.");
		t.eq("a linking code opens no session", await t.session(stranger.context), null);
		await t.enterCode(owner.page, linkCode);
		await t.sees(owner.page, "Email is linked");
		await t.proof(owner.page, "linked");
		t.eq("D1 methods", methodsOf(id), ["email", "github"]);
		await t.requestSignIn(stranger.page, email);
		await t.enterCode(stranger.page, await latestCode(email));
		await t.workspace(stranger.page);
		await t.proof(stranger.page, "home-via-email");
		t.eq("email sign-in opens the same account", (await t.session(stranger.context))?.user.id, id);
		await t.emails(email);
	},
};

J["link-rejected"] = {
	feature: "linking",
	async run(t) {
		const github = gitHubUser();
		const { page } = await t.visitor();
		await t.continueWith(page, "GitHub", github);
		const id = userByEmail(github.email).id;

		await t.link(page, "Google", googleUser());
		await t.sees(page, "That Google account uses a different email");
		await t.proof(page, "mismatch");

		const taken = googleUser({ email: `taken${nextId}@example.com` });
		const other = await t.visitor();
		await t.continueWith(other.page, "Google", taken);
		await t.link(page, "Google", { ...taken, email: github.email });
		await t.sees(page, "That Google account belongs to another Ditto account");
		await t.proof(page, "linked-elsewhere");

		await t.link(page, "Google", { cancel: true });
		await t.sees(page, "Google wasn’t linked");
		await t.sees(page, "You cancelled before it finished. Nothing changed.");
		await t.proof(page, "cancelled");

		await t.link(page, "Email");
		await page.getByRole("heading", { name: "Add email sign-in" }).waitFor();
		await page.getByRole("button", { name: "Back to Settings" }).click();
		await t.sees(page, "Email wasn’t linked");
		await t.proof(page, "email-cancelled");

		t.eq("D1 methods unchanged", methodsOf(id), ["github"]);
		t.eq("D1 taken Google identity kept its owner", rows("select u.email from account a join user u on u.id = a.user_id where a.provider_id = 'google' and a.account_id = ?", taken.sub)[0]?.email, taken.email);
	},
};

// --- sessions

J["protected-routes"] = {
	feature: "session",
	async run(t) {
		for (const p of ["/", "/settings", "/settings/verify-email"]) {
			const r = await fetch(`${APP}${p}`, { redirect: "manual" });
			t.eq(`${p} signed out → `, [r.status >= 300 && r.status < 400, new URL(r.headers.get("location") ?? "", APP).pathname], [true, "/sign-in"]);
		}
		for (const p of ["/design", "/design/auth", "/design/workspace?state=opened", "/design/site-request?state=waiting", "/design.md"]) {
			t.eq(`${p} public`, (await fetch(`${APP}${p}`, { redirect: "manual" })).status, 200);
		}
		const { page } = await t.visitor();
		await t.open(page, "/settings");
		await t.proof(page, "settings-signed-out");
		t.eq("browser lands on", t.path(page), "/sign-in");
	},
};

J["session-lifecycle"] = {
	feature: "session",
	async run(t) {
		const github = gitHubUser();
		const laptop = await t.visitor();
		const phone = await t.visitor(devices["Pixel 7"]);
		await t.continueWith(laptop.page, "GitHub", github);
		await t.continueWith(phone.page, "GitHub", github);
		const id = userByEmail(github.email).id;
		t.eq("D1 two independent sessions", sessionCount(id), 2);
		await laptop.page.reload({ waitUntil: "networkidle" });
		t.eq("survives a refresh", t.path(laptop.page), "/");
		const cookies = await laptop.context.cookies(APP);
		const token = cookies.find((c) => c.name.endsWith(".session_token"));
		t.eq("session cookie is HttpOnly, host-only, Lax", [token?.httpOnly, token?.domain, token?.sameSite], [true, "localhost", "Lax"]);
		await t.signOut(laptop.page);
		await t.sees(laptop.page, "Signed out");
		await t.proof(laptop.page, "signed-out");
		t.eq("D1 sign-out revoked one session", sessionCount(id), 1);
		await phone.page.reload({ waitUntil: "networkidle" });
		await t.proof(phone.page, "phone-still-in");
		t.eq("phone stays signed in", t.path(phone.page), "/");
		const replay = await t.visitor();
		await replay.context.addCookies(cookies);
		t.eq("replayed cookie has no session", await t.session(replay.context), null);
		await t.open(replay.page, "/");
		t.eq("replayed cookie lands on", t.path(replay.page), "/sign-in");
	},
};

J["session-expiry"] = {
	feature: "session",
	async run(t) {
		const { page } = await t.visitor();
		await t.continueWith(page, "GitHub", gitHubUser());
		await sleep((SESSION_EXPIRES_IN + 2) * 1000);
		await page.reload({ waitUntil: "networkidle" });
		await t.proof(page, "after-idle");
		t.eq(`idle ${SESSION_EXPIRES_IN + 2}s lands on`, t.path(page), "/sign-in");
	},
};

// ---------------------------------------------------------------- runner

if (flag("list")) {
	for (const [id, j] of Object.entries(J)) console.log(`${j.feature.padEnd(14)} ${id}`);
	process.exit(0);
}
const ONLY = opt("only")?.split(",");
const unknown = ONLY?.filter((id) => !J[id]) ?? [];
if (unknown.length) {
	console.error(`unknown journey ids: ${unknown.join(", ")} (see --list)`);
	process.exit(2);
}
const selected = Object.entries(J).filter(([id]) => !ONLY || ONLY.includes(id));

try {
	if (!UPSTREAM) throw new Precondition("VERIFY_AUTH_UPSTREAM is unset: run through auth.sh after auth.sh up");
	if ((await fetch(`${APP}/api/auth/get-session`).then((r) => r.text(), () => "")) !== "null")
		throw new Precondition(`${APP} is not a signed-out Ditto stage: run auth.sh doctor`);
	db().close();
} catch (error) {
	console.error(`Precondition: ${error.message}`);
	process.exit(2);
}

mkdirSync(OUT, { recursive: true });
browser = await chromium.launch({ headless: !flag("headed") });
const results = [];
for (const [id, j] of selected) {
	const t = journey(id);
	const started = Date.now();
	let error;
	try {
		await j.run(t);
	} catch (e) {
		error = e;
		for (const [i, p] of t.pages.entries())
			await p.screenshot({ path: join(t.dir, `fail-page${i}.png`) }).catch(() => {});
	}
	await t.close();
	const seconds = ((Date.now() - started) / 1000).toFixed(1);
	results.push({ id, feature: j.feature, pass: !error, seconds, error: error?.message, facts: t.facts });
	console.log(`${error ? "FAIL" : "PASS"}  ${id.padEnd(20)} ${seconds}s${error ? `  ${error.message.split("\n")[0]}` : ""}`);
	writeFileSync(join(t.dir, "facts.json"), JSON.stringify(t.facts, null, "\t"));
}
await browser.close();

const failed = results.filter((r) => !r.pass);
const md = [
	`# verify-auth run ${stamp}`,
	"",
	`App ${APP}, upstream ${UPSTREAM}, D1 ${D1}`,
	`Knobs: session ${SESSION_EXPIRES_IN}s, code ${CODE_EXPIRES_IN}s, resend ${CODE_RESEND_IN}s`,
	"",
	`**${results.length - failed.length}/${results.length} passed**`,
	"",
	...results.flatMap((r) => [
		`## ${r.pass ? "PASS" : "FAIL"} \`${r.id}\` (${r.feature}, ${r.seconds}s)`,
		"",
		...(r.error ? ["```", r.error, "```", ""] : []),
		...r.facts.map((f) => `- ${f.pass ? "✓" : "✗"} ${f.label}: \`${JSON.stringify(f.got)}\``),
		"",
		`Evidence: \`${r.id}/\``,
		"",
	]),
].join("\n");
writeFileSync(join(OUT, "report.md"), md);
writeFileSync(join(OUT, "report.json"), JSON.stringify(results, null, "\t"));
console.log(`\n${results.length - failed.length}/${results.length} passed. Report: ${join(OUT, "report.md")}`);
process.exit(failed.length ? 1 : 0);
