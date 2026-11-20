import { fileURLToPath } from "node:url";

import { createServer } from "vite-plus";
import { expect, it } from "vite-plus/test";

it("serves the homepage with Ditto's metadata", async () => {
	const server = await createServer({
		root: fileURLToPath(new URL("../", import.meta.url)),
		server: { host: "127.0.0.1", port: 0 },
		logLevel: "error",
	});

	try {
		await server.listen();
		const [url] = server.resolvedUrls!.local;
		const response = await fetch(url);
		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain("<title>Ditto</title>");
	} finally {
		await server.close();
	}
}, 30_000);
