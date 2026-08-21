const ARCHIVE_ID_RE = /^[-A-Za-z0-9_]{1,128}$/;

export function serializeSandboxBackup(archiveId: string): string {
	const parsed = parseSandboxBackup(archiveId);
	if (!parsed) {
		throw new Error("Invalid sandbox archive id.");
	}
	return parsed;
}

export function parseSandboxBackup(value: string | null): string | null {
	if (!value) {
		return null;
	}

	const archiveId = value.trim();
	if (
		!archiveId ||
		archiveId.startsWith("{") ||
		archiveId.startsWith("[") ||
		!ARCHIVE_ID_RE.test(archiveId)
	) {
		return null;
	}

	return archiveId;
}
