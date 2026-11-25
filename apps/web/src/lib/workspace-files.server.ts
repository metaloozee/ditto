import { env } from "cloudflare:workers";

import { requestedFileKey } from "./workspace-files.ts";

// A missing file, another account's and an unsafe path answer alike, so keys can't be probed.
export const noSuchFile = () => Response.json({ error: "No such file" }, { status: 404 });

/**
 * Serves `GET /api/workspaces/<id>/files/<kind>/<name>` from the private bucket, once the
 * gateway admitted the owner. `path` is the raw remainder after `files/`, before any router
 * decoding: `requestedFileKey` decodes each segment once. The key's workspace is the admitted
 * ID, never anything in the path.
 */
export async function serveFile(workspaceId: string, path: string): Promise<Response> {
	const key = requestedFileKey(workspaceId, path);
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
