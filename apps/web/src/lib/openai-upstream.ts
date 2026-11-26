const OPENAI = "https://api.openai.com/";

/**
 * The fetch for an api.openai.com call. On the test stage it sends the request to the fake
 * upstream as `${upstream}/api.openai.com/<path>`, passed per call rather than patched into the
 * global fetch; elsewhere it is the plain fetch.
 */
export function openaiFetch(upstream: string | undefined): typeof fetch {
	if (!upstream) return fetch;
	return (input, init) => {
		const request = new Request(input, init);
		if (!request.url.startsWith(OPENAI)) return fetch(request);
		return fetch(
			new Request(`${upstream}/api.openai.com/${request.url.slice(OPENAI.length)}`, request),
		);
	};
}
