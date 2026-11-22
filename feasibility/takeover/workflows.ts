// The representative login workflows (#29). Each task is read-only: it proves the bot can use
// the owner's session without posting, buying or changing anything.
// `done` runs in the page and must return a boolean, never page text.

export type Workflow = {
	name: string;
	login: string;
	task: { describe: string; url: string; done: string };
};

export const workflows = {
	google: {
		name: "Google",
		login: "https://accounts.google.com/",
		task: {
			describe: "open Google Account home and confirm it is signed in",
			url: "https://myaccount.google.com/",
			// Signed out, Google redirects to accounts.google.com or offers a sign-in link.
			done: `location.host === "myaccount.google.com" && !document.querySelector('a[href*="ServiceLogin"]')`,
		},
	},
	linkedin: {
		name: "LinkedIn",
		login: "https://www.linkedin.com/login",
		task: {
			describe: "open the LinkedIn feed and confirm it is signed in",
			url: "https://www.linkedin.com/feed/",
			// Signed out, LinkedIn redirects to /login, /authwall or /uas.
			done: `location.pathname.startsWith("/feed") && !document.querySelector('input[type="password"]')`,
		},
	},
	protected: {
		name: "Cloudflare dashboard (Turnstile-protected)",
		login: "https://dash.cloudflare.com/login",
		task: {
			describe: "open the Cloudflare dashboard home and confirm it is signed in",
			url: "https://dash.cloudflare.com/",
			// Signed out, the dashboard redirects to /login.
			done: `location.host === "dash.cloudflare.com" && !/^\\/(login|sign-up)/.test(location.pathname)`,
		},
	},
} satisfies Record<string, Workflow>;

export type WorkflowId = keyof typeof workflows;
