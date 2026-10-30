const LABEL =
	/^10000-c-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[a-z0-9_]{1,16}$/;

/** A candidate preview host: one `10000-c-<session>-<token>` label under `ayn.wtf` or `localhost`. */
export function isCandidatePreviewHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	for (const suffix of [".ayn.wtf", ".localhost"]) {
		if (host.endsWith(suffix)) {
			return LABEL.test(host.slice(0, -suffix.length));
		}
	}
	return false;
}

/** A URL the runtime may hand the preview pane: https under ayn.wtf with no port, or http under localhost. */
export function isCandidatePreviewUrl(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.username || url.password) return false;
	const host = url.hostname.toLowerCase();
	const schemeMatchesHost =
		(url.protocol === "https:" &&
			url.port === "" &&
			host.endsWith(".ayn.wtf")) ||
		(url.protocol === "http:" && host.endsWith(".localhost"));
	return schemeMatchesHost && isCandidatePreviewHost(host);
}
