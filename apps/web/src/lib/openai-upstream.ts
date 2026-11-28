const OPENAI = /^https:\/\/(api|auth)\.openai\.com\//;

/**
 * The fetch for an api.openai.com or auth.openai.com call. On the test stage it sends the
 * request to the fake upstream as `${upstream}/<host>/<path>`, passed per call rather than
 * patched into the global fetch; elsewhere it is the plain fetch.
 */
export function openaiFetch(upstream: string | undefined): typeof fetch {
	if (!upstream) return fetch;
	return (input, init) => {
		const request = new Request(input, init);
		if (!OPENAI.test(request.url)) return fetch(request);
		return fetch(new Request(`${upstream}/${request.url.slice("https://".length)}`, request));
	};
}
