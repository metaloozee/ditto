// Each trial workspace's destination list, passed to Browser Run as the session's
// `guardrails.allowedDomains`. A Worker cannot read the .txt lists the Containers image bakes in,
// so they are repeated here; browser-run-gate.test.ts fails when the two drift apart.
// Guardrails match hosts exactly: `*.example.com` would not match `example.com`.

/** Browser Run refuses a session whose list has more entries than this. */
export const GUARDRAIL_LIMIT = 50;

export const DESTINATIONS = {
	// The hosts the #27 and #28 checks approved (containers/destinations/ws-cloud-trial.txt).
	"ws-cloud-trial": ["example.com", "echo.websocket.org"],
	// The #29 login workflows (takeover/destinations/ws-takeover.txt), Google then LinkedIn.
	"ws-takeover": [
		"accounts.google.com",
		"myaccount.google.com",
		"www.google.com",
		"www.gstatic.com",
		"ssl.gstatic.com",
		"fonts.gstatic.com",
		"fonts.googleapis.com",
		"apis.google.com",
		"lh3.googleusercontent.com",
		"accounts.youtube.com",
		"www.linkedin.com",
		"static.licdn.com",
		"media.licdn.com",
		"platform.linkedin.com",
		"dash.cloudflare.com",
		"challenges.cloudflare.com",
		"brunhild.challenges.cloudflare.com",
		"platform.dash.cloudflare.com",
	],
} satisfies Record<string, string[]>;

export type WorkspaceId = keyof typeof DESTINATIONS;

export const isWorkspace = (name: string): name is WorkspaceId => Object.hasOwn(DESTINATIONS, name);
