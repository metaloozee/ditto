export class SessionWorkspaceBusyError extends Error {
	constructor() {
		super(
			"This session is busy. Wait for the active agent or Git operation to finish.",
		);
		this.name = "SessionWorkspaceBusyError";
	}
}
