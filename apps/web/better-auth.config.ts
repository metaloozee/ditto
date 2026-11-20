import { createAuth, type AuthEnv } from "./src/lib/auth.ts";

// Read by the Better Auth CLI to generate `src/db/auth-schema.ts`; never served.
export const auth = createAuth({
	DB: {},
	BETTER_AUTH_URL: "http://localhost:1337",
	BETTER_AUTH_SECRET: "schema-generation-only-secret-000000",
	GITHUB_CLIENT_ID: "schema",
	GITHUB_CLIENT_SECRET: "schema",
	GOOGLE_CLIENT_ID: "schema",
	GOOGLE_CLIENT_SECRET: "schema",
	RESEND_API_KEY: "schema",
	RESEND_FROM: "schema",
} as AuthEnv);
