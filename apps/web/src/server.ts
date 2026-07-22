import { proxyToSandbox, type SandboxEnv } from "@cloudflare/sandbox";
import handler from "@tanstack/react-start/server-entry";

export { Sandbox } from "@cloudflare/sandbox";

const PREVIEW_ZONE_SUFFIX = ".ayn.wtf";

function isProductionPreviewHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	if (!host.endsWith(PREVIEW_ZONE_SUFFIX)) {
		return false;
	}
	const labels = host.slice(0, -PREVIEW_ZONE_SUFFIX.length);
	// Proper subdomain: one or more non-empty labels (not the apex).
	return labels.length > 0 && !labels.startsWith(".") && !labels.endsWith(".");
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const proxied = await proxyToSandbox(request, env as unknown as SandboxEnv);
		if (proxied) {
			return proxied;
		}

		const hostname = new URL(request.url).hostname;
		if (isProductionPreviewHost(hostname)) {
			return new Response("Not Found", { status: 404 });
		}

		return handler.fetch(request);
	},
};
