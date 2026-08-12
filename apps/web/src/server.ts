import { ContainerProxy } from "@cloudflare/containers";
import { proxyToSandbox, type SandboxEnv } from "@cloudflare/sandbox";
import handler from "@tanstack/react-start/server-entry";

export { Sandbox } from "@cloudflare/sandbox";
export { TrustedGitExecutor } from "#/lib/trusted-git-executor";
export { ContainerProxy };

const PREVIEW_ZONE_SUFFIX = ".ayn.wtf";

// Neutral tokens — preview iframe has no app CSS vars.
const PREVIEW_SCROLLBAR_STYLE =
	"<style data-ditto-scrollbar>" +
	"*{scrollbar-width:thin;scrollbar-color:color-mix(in oklch,oklch(.55 0 0) 40%,transparent) transparent}" +
	"*::-webkit-scrollbar{width:6px;height:6px}" +
	"*::-webkit-scrollbar-track,*::-webkit-scrollbar-corner{background:transparent}" +
	"*::-webkit-scrollbar-thumb{background:color-mix(in oklch,oklch(.55 0 0) 40%,transparent);border-radius:9999px}" +
	"*::-webkit-scrollbar-thumb:hover{background:color-mix(in oklch,oklch(.55 0 0) 60%,transparent)}" +
	"</style>";

function isProductionPreviewHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	if (!host.endsWith(PREVIEW_ZONE_SUFFIX)) {
		return false;
	}
	const labels = host.slice(0, -PREVIEW_ZONE_SUFFIX.length);
	// Proper subdomain: one or more non-empty labels (not the apex).
	return labels.length > 0 && !labels.startsWith(".") && !labels.endsWith(".");
}

function isHtmlResponse(response: Response): boolean {
	const type = response.headers.get("content-type")?.toLowerCase() ?? "";
	return type.includes("text/html");
}

async function injectPreviewScrollbar(response: Response): Promise<Response> {
	if (
		!isHtmlResponse(response) ||
		response.status === 204 ||
		response.status === 304
	) {
		return response;
	}

	const html = await response.text();
	if (html.includes("data-ditto-scrollbar")) {
		return new Response(html, {
			status: response.status,
			statusText: response.statusText,
			headers: stripBodyHeaders(response.headers),
		});
	}

	let next: string;
	if (/<\/head>/i.test(html)) {
		next = html.replace(/<\/head>/i, `${PREVIEW_SCROLLBAR_STYLE}</head>`);
	} else if (/<body\b[^>]*>/i.test(html)) {
		next = html.replace(
			/<body\b[^>]*>/i,
			(open) => `${open}${PREVIEW_SCROLLBAR_STYLE}`,
		);
	} else {
		next = `${PREVIEW_SCROLLBAR_STYLE}${html}`;
	}

	return new Response(next, {
		status: response.status,
		statusText: response.statusText,
		headers: stripBodyHeaders(response.headers),
	});
}

function stripBodyHeaders(source: Headers): Headers {
	const headers = new Headers(source);
	headers.delete("content-length");
	headers.delete("content-encoding");
	return headers;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const proxied = await proxyToSandbox(request, env as unknown as SandboxEnv);
		if (proxied) {
			return injectPreviewScrollbar(proxied);
		}

		const hostname = new URL(request.url).hostname;
		if (isProductionPreviewHost(hostname)) {
			return new Response("Not Found", { status: 404 });
		}

		return handler.fetch(request);
	},
};
