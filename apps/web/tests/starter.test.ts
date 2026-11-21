import { fileURLToPath } from "node:url";

import { createServer } from "vite-plus";
import { expect, it } from "vite-plus/test";

// /design needs no Worker bindings, so it renders without the auth database.
it("serves the design system on a plain Vite server", async () => {
	const server = await createServer({
		root: fileURLToPath(new URL("../", import.meta.url)),
		server: { host: "127.0.0.1", port: 0 },
		logLevel: "error",
		// Its own dependency cache, so it can't re-optimize under the auth suite's dev server.
		cacheDir: "node_modules/.vite-starter",
	});

	try {
		await server.listen();
		const [url] = server.resolvedUrls!.local;
		const response = await fetch(new URL("design", url));
		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain("<title>Design system · Ditto</title>");
	} finally {
		await server.close();
	}
}, 30_000);
