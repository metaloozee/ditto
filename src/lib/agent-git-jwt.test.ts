import { describe, expect, it } from "vitest";
import {
	AGENT_GIT_JWT_TTL_SECONDS,
	mintAgentGitJwt,
	verifyAgentGitJwt,
} from "./agent-git-jwt";

const SECRET = "test-secret-for-agent-git-jwt";

describe("agent-git-jwt", () => {
	it("mints and verifies a valid token", async () => {
		const now = 1_700_000_000;
		const token = await mintAgentGitJwt({
			secret: SECRET,
			projectId: "proj-1",
			sessionId: "sess-1",
			userId: "user-1",
			sandboxId: "sandbox-1",
			nowSeconds: now,
		});

		const verified = await verifyAgentGitJwt(token, SECRET, now);
		expect(verified).toEqual({
			ok: true,
			claims: {
				sub: "agent-git",
				projectId: "proj-1",
				sessionId: "sess-1",
				userId: "user-1",
				sandboxId: "sandbox-1",
				exp: now + AGENT_GIT_JWT_TTL_SECONDS,
			},
		});
	});

	it("rejects expired tokens", async () => {
		const now = 1_700_000_000;
		const token = await mintAgentGitJwt({
			secret: SECRET,
			projectId: "proj-1",
			sessionId: "sess-1",
			userId: "user-1",
			sandboxId: "sandbox-1",
			nowSeconds: now,
		});

		const verified = await verifyAgentGitJwt(
			token,
			SECRET,
			now + AGENT_GIT_JWT_TTL_SECONDS + 1,
		);
		expect(verified).toEqual({ ok: false, reason: "expired" });
	});

	it("rejects wrong secret", async () => {
		const token = await mintAgentGitJwt({
			secret: SECRET,
			projectId: "proj-1",
			sessionId: "sess-1",
			userId: "user-1",
			sandboxId: "sandbox-1",
		});

		const verified = await verifyAgentGitJwt(token, "other-secret");
		expect(verified).toEqual({ ok: false, reason: "bad_signature" });
	});

	it("rejects malformed tokens", async () => {
		const verified = await verifyAgentGitJwt("not-a-jwt", SECRET);
		expect(verified).toEqual({ ok: false, reason: "malformed" });
	});

	it("rejects valid-base64 signatures that do not verify (bad_signature)", async () => {
		const token = await mintAgentGitJwt({
			secret: SECRET,
			projectId: "proj-1",
			sessionId: "sess-1",
			userId: "user-1",
			sandboxId: "sandbox-1",
		});
		const parts = token.split(".");
		// Replace signature with different valid base64url bytes (all zeros encoded)
		const tampered = `${parts[0]}.${parts[1]}.${btoa("\0".repeat(32)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
		const verified = await verifyAgentGitJwt(tampered, SECRET);
		expect(verified).toEqual({ ok: false, reason: "bad_signature" });
	});
});
