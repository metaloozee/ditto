import type { ConnectionView, DeviceAuthStart } from "./codex-credential-do";

export interface ConnectionOperations {
	status(owner: string): Promise<ConnectionView>;
	/** `disabled` means device sign-in is not configured for this deployment. */
	connect(owner: string): Promise<DeviceAuthStart | { status: "disabled" }>;
	disconnect(owner: string): Promise<void>;
}

export async function handleCodexConnection(input: {
	authenticatedUserId: string | null;
	body: unknown;
	operations: ConnectionOperations;
}): Promise<{
	status: number;
	body: { code: string } | ConnectionView | DeviceAuthStart;
}> {
	if (!input.authenticatedUserId)
		return { status: 401, body: { code: "unauthorized" } };
	if (
		!input.body ||
		typeof input.body !== "object" ||
		Array.isArray(input.body)
	)
		return { status: 400, body: { code: "invalid_request" } };
	const body = input.body as Record<string, unknown>;
	if (
		Object.keys(body).length !== 1 ||
		typeof body.action !== "string" ||
		!["status", "disconnect", "connect"].includes(body.action)
	)
		return { status: 400, body: { code: "invalid_request" } };
	if (body.action === "connect") {
		const started = await input.operations.connect(input.authenticatedUserId);
		if (started.status === "disabled")
			return { status: 503, body: { code: "codex_hosted_auth_unverified" } };
		if (started.status === "unavailable")
			return { status: 503, body: { code: "codex_device_auth_unavailable" } };
		return { status: 200, body: started };
	}
	if (body.action === "disconnect") {
		await input.operations.disconnect(input.authenticatedUserId);
		return { status: 200, body: { status: "disconnected", generation: 0 } };
	}
	return {
		status: 200,
		body: await input.operations.status(input.authenticatedUserId),
	};
}
