import { env } from "cloudflare:workers";

import { requestedFileKey } from "./workspace-files.ts";
import { admit } from "./workspace-gateway.server.ts";

// A missing file, another account's and an unsafe path answer alike, so keys can't be probed.
const noSuchFile = () => Response.json({ error: "No such file" }, { status: 404 });

/**
 * Serves `GET /api/workspace/<id>/files/<kind>/<name>` from the private bucket, to the
 * workspace's owner only. The key's workspace comes from the admitted ID, never the path.
 */
export async function serveFile(request: Request, workspaceId: string): Promise<Response> {
	const admitted = await admit(request.headers, workspaceId);
	if (admitted instanceof Response) return admitted.status === 404 ? noSuchFile() : admitted;

	// The raw path, before any router decoding: `requestedFileKey` decodes each segment once.
	const prefix = `/api/workspace/${admitted.workspaceId}/files/`;
	const { pathname } = new URL(request.url);
	if (!pathname.startsWith(prefix)) return noSuchFile();
	const key = requestedFileKey(admitted.workspaceId, pathname.slice(prefix.length));
	const object = key === null ? null : await env.FILES.get(key);
	if (!object) return noSuchFile();

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("etag", object.httpEtag);
	headers.set("cache-control", "private, no-store");
	// A published page runs as an opaque origin with no scripts, never as the app.
	headers.set("content-security-policy", "sandbox");
	headers.set("x-content-type-options", "nosniff");
	return new Response(object.body, { headers });
}
