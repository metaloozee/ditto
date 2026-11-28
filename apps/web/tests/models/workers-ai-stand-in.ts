// Stands in for the `AI` binding on the test stage, which can't reach Workers AI. Its `fetch`
// passes each request, unchanged, to the fake Workers AI in the test upstream.
export default {
	fetch(request: Request, env: { UPSTREAM: string }): Promise<Response> {
		const url = new URL(request.url);
		return fetch(new Request(`${env.UPSTREAM}/${url.host}${url.pathname}${url.search}`, request));
	},
};
