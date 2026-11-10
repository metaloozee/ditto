import type { ConnectionOperations } from "./codex-connection";
import type { ConnectionView, DeviceAuthStart } from "./codex-credential-do";

export function createCodexConnectionOperations(bindings: {
	DB: D1Database;
	CODEX_DEVICE_AUTH?: string;
	CodexCredential: {
		getByName(owner: string): {
			status(owner: string): Promise<ConnectionView>;
			revoke(owner: string, generation: number): Promise<void>;
			startDeviceAuth(
				owner: string,
				generation: number,
			): Promise<DeviceAuthStart>;
		};
	};
}): ConnectionOperations {
	return {
		status: (owner) => bindings.CodexCredential.getByName(owner).status(owner),
		async connect(owner) {
			if (bindings.CODEX_DEVICE_AUTH !== "1") return { status: "disabled" };
			// Product state commits first: the new generation fences every older sign-in.
			const row = await bindings.DB.prepare(
				"INSERT INTO codex_connections(user_id,generation,revoked,status,projection_version,updated_at) VALUES(?,1,0,'reconnect_required',0,?) ON CONFLICT(user_id) DO UPDATE SET generation=generation+1,revoked=0,status='reconnect_required',projection_version=0,updated_at=excluded.updated_at RETURNING generation",
			)
				.bind(owner, Date.now())
				.first<{ generation: number }>();
			if (!row) return { status: "unavailable", generation: 0 };
			return bindings.CodexCredential.getByName(owner).startDeviceAuth(
				owner,
				row.generation,
			);
		},
		async disconnect(owner) {
			// Product revocation commits first. A failed DO handoff cannot preserve authority.
			const row = await bindings.DB.prepare(
				"UPDATE codex_connections SET generation=generation+1,revoked=1,status='disconnected',updated_at=? WHERE user_id=? RETURNING generation",
			)
				.bind(Date.now(), owner)
				.first<{ generation: number }>();
			if (row)
				await bindings.CodexCredential.getByName(owner).revoke(
					owner,
					row.generation,
				);
		},
	};
}
