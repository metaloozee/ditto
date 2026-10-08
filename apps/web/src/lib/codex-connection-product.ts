import type { ConnectionOperations } from "./codex-connection";
import type { ConnectionView } from "./codex-credential-do";

export function createCodexConnectionOperations(bindings: {
	DB: D1Database;
	CodexCredential: {
		getByName(owner: string): {
			status(owner: string): Promise<ConnectionView>;
			revoke(owner: string, generation: number): Promise<void>;
		};
	};
}): ConnectionOperations {
	return {
		status: (owner) => bindings.CodexCredential.getByName(owner).status(owner),
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
