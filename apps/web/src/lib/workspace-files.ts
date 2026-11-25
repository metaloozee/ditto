/**
 * The R2 key scheme for a workspace's files, documented in `docs/architecture.md`. Every key
 * starts with the workspace ID, so the key and the D1 ownership check alone decide who may
 * read it. Keys are stable: changing this scheme strands every object already written.
 */
export const FILE_KINDS = ["published", "screenshots", "home"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

const WORKSPACE_ID = /^[a-z0-9-]+$/;
// Control characters and backslashes never appear in a name, so no reader can mistake one.
// oxlint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f\\/]/;

/**
 * The key of `name` among the workspace's files of `kind`: `<workspaceId>/<kind>/<name>`.
 * `name` is one or more `/`-separated segments. Answers `null` for a name that could leave
 * that prefix or be read two ways: an empty, `.` or `..` segment, a backslash or a control
 * character.
 */
export function fileKey(workspaceId: string, kind: FileKind, name: string): string | null {
	if (!WORKSPACE_ID.test(workspaceId)) return null;
	const segments = name.split("/");
	if (!segments.every(isSafeSegment)) return null;
	return `${workspaceId}/${kind}/${segments.join("/")}`;
}

/**
 * The key a request path names within the workspace, `null` if it names none safely. The
 * path is still percent-encoded, as in a URL: `<kind>/<segment>/...`. Each segment is decoded
 * once, and one that decodes to a separator is refused, so `%2F` and `%2e%2e` can't escape.
 */
export function requestedFileKey(workspaceId: string, encodedPath: string): string | null {
	const [kind, ...encoded] = encodedPath.split("/");
	if (!isFileKind(kind)) return null;
	const segments: string[] = [];
	for (const segment of encoded) {
		let decoded: string;
		try {
			decoded = decodeURIComponent(segment);
		} catch {
			return null;
		}
		if (!isSafeSegment(decoded)) return null;
		segments.push(decoded);
	}
	return fileKey(workspaceId, kind, segments.join("/"));
}

const isFileKind = (kind: string | undefined): kind is FileKind =>
	FILE_KINDS.some((known) => known === kind);

function isSafeSegment(segment: string): boolean {
	return segment !== "" && segment !== "." && segment !== ".." && !UNSAFE.test(segment);
}
