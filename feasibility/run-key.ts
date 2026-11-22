// The run-key gate shared by the deployed feasibility Workers: only the owner, who holds the key,
// can make them spend a model plan or start a billed instance.

/** Compares digests, so the comparison takes the same time whatever the guess. */
export async function sameSecret(given: string, expected: string): Promise<boolean> {
	if (!expected) return false;
	const digest = async (value: string) =>
		new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
	const [a, b] = await Promise.all([digest(given), digest(expected)]);
	return a.every((byte, i) => byte === b[i]);
}

/** A 401 unless the request carries the run key in `x-trial-key`. An empty key refuses all. */
export async function requireRunKey(request: Request, key: string): Promise<Response | undefined> {
	if (await sameSecret(request.headers.get("x-trial-key") ?? "", key)) return undefined;
	return new Response("Unauthorized", { status: 401 });
}

/** The Cloudflare data centre that served the request, or `unknown` off Cloudflare. */
export function coloOf(request: Request): string {
	const cf: unknown = Reflect.get(request, "cf");
	const colo: unknown = cf && typeof cf === "object" ? Reflect.get(cf, "colo") : undefined;
	return typeof colo === "string" ? colo : "unknown";
}
