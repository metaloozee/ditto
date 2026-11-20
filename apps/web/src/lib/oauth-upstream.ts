// Hosts whose server-to-server OAuth calls a test stage sends to its fake upstream.
const HOSTS = new Set(["github.com", "api.github.com"]);

let redirected = false;

/**
 * Sends Better Auth's token and profile requests to `upstream` instead of the
 * real provider, as `${upstream}/<host>/<path>`. Only the test stage binds the
 * `OAUTH_UPSTREAM` that enables it.
 */
export function redirectOAuthUpstream(upstream: string) {
	if (redirected) return;
	redirected = true;
	const fetchUpstream = globalThis.fetch;
	globalThis.fetch = (input, init) => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		if (url.protocol !== "https:" || !HOSTS.has(url.hostname)) return fetchUpstream(request);
		return fetchUpstream(
			new Request(`${upstream}/${url.hostname}${url.pathname}${url.search}`, request),
		);
	};
}
