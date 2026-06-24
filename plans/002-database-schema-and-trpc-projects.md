# Plan 002: Database Schema and tRPC Projects

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report - do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 150dc21..HEAD -- src/db/schema.ts src/integrations/trpc/router.ts src/lib/crypto.ts migrations`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: feature
- **Planned at**: commit `150dc21`, 2026-06-24

## Why this matters

The onboarding dialog already collects project data for both the GitHub import path and the scratch path, but there is still no server-side persistence layer for projects. This plan adds the missing database table and a `projects` tRPC router so later plans can create records, list them, and attach sandbox lifecycle state to them.

Environment variables entered during onboarding are sensitive. They should be encrypted at rest before they are written to D1, using the app secret already present in the Worker environment. This plan only builds the persistence layer; wiring the dialog to call `projects.create` and starting sandbox bootstrapping stay out of scope.

## Current state

- `src/db/schema.ts` currently defines app tables plus Better Auth tables. Custom app tables use `created_at` timestamps, while the Better Auth tables are already established and should not be rewritten:

```ts
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const todos = sqliteTable("todos", {
	id: integer({ mode: "number" }).primaryKey({
		autoIncrement: true,
	}),
	title: text().notNull(),
	createdAt: integer("created_at", { mode: "timestamp" }).default(
		sql`(unixepoch())`,
	),
});

export const user = sqliteTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
```

- `src/db/index.ts` is the existing database entrypoint. Match this pattern instead of creating a second DB helper:

```ts
import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema";

export function createDb(env: Pick<Env, "DB">) {
	return drizzle(env.DB, { schema });
}
```

- `src/integrations/trpc/router.ts` already contains both `health` and `github` routers. Extend this file without removing or rewriting the existing GitHub procedures:

```ts
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { z } from "zod";
import { getGitHubApp } from "#/lib/github-app";
import { getGitHubImportState } from "#/lib/github-repositories";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "./init";

const githubRouter = {
	importState: protectedProcedure.query(async ({ ctx }) => {
		const installUrl = ctx.env.VITE_GITHUB_APP_INSTALL_URL;
		// ...
		return await getGitHubImportState({ accessToken, installUrl });
	}),

	listBranches: protectedProcedure
		.input(
			z.object({
				owner: z.string(),
				repo: z.string(),
				installationId: z.number(),
			}),
		)
		.query(async ({ ctx, input }) => {
			// ...
		}),
} satisfies TRPCRouterRecord;

export const trpcRouter = createTRPCRouter({
	health: healthRouter,
	github: githubRouter,
});
```

- `src/lib/github-repositories.ts` already exposes the GitHub installation id on each repository record. The current dialog does not persist that selection yet, but the backend schema should support it because later plans will need it:

```ts
export type GitHubRepo = {
	id: number;
	name: string;
	owner: string;
	repoName: string;
	language: string | null;
	isPrivate: boolean;
	stars: number;
	installationId: number;
};
```

- `src/components/new-project-dialog.tsx` no longer captures a branch, and that is intentional. Do not add branch selection back in this plan. The current submit path still only advances or closes the dialog:

```ts
const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
const [envVars, setEnvVars] = useState<EnvVar[]>([]);

const handleContinue = useCallback(() => {
	if (step === "github" || step === "scratch") {
		setStep("ready");
	} else if (step === "ready") {
		handleClose();
	}
}, [step, handleClose]);
```

- `alchemy.run.ts` already configures D1 with Drizzle-compatible migration tracking. In this repo, Drizzle generates SQL into `migrations/`, and Alchemy applies those SQL files on the next deploy/update because `D1Database` is configured with both `migrationsDir` and `migrationsTable`:

```ts
const database = await D1Database("database", {
	name: `${app.name}-${app.stage}-db`,
	migrationsDir: "./migrations",
	migrationsTable: "drizzle_migrations",
})
```

Repo note from docs to follow here:

- Cloudflare D1 documents `wrangler d1 migrations apply` for applying unapplied SQL migrations, but that is Wrangler's explicit apply flow.
- Alchemy's `D1Database` docs state that when `migrationsDir` is configured, SQL files in that directory are applied automatically on the next resource update, and `migrationsTable` can be set to `drizzle_migrations` for Drizzle compatibility.
- For this repo, the executor should generate SQL with `pnpm db:generate` and should **not** add `pnpm db:migrate` to the workflow for this plan.

- Repo conventions to match:

```ts
import { createAuth } from "#/lib/auth";
import * as schema from "#/db/schema";

export function createAuth(env: Env) {
	const db = createDb(env);

	return betterAuth({
		secret: env.BETTER_AUTH_SECRET,
		database: drizzleAdapter(db, {
			provider: "sqlite",
			schema,
		}),
	});
}
```

Use `#/` imports for app modules, keep router grouping by feature (`health`, `github`, `projects`), and use `protectedProcedure` for user-scoped data.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Generate migration SQL | `pnpm db:generate` | new SQL file in `migrations/` and updated `migrations/meta/*` |
| Build | `pnpm build` | exit 0 |

There is no established automated test harness for this work yet. Do not add one in this plan.

## Scope

**In scope**:
- `src/lib/crypto.ts` (create)
- `src/db/schema.ts`
- Generated files under `migrations/`
- `src/integrations/trpc/router.ts`

**Out of scope**:
- `src/components/new-project-dialog.tsx`
- Sandbox creation, bootstrap, or hibernation logic (covered by Plan 003)
- Reintroducing branch selection anywhere in the app
- Adding a new test framework or test harness

## Git workflow

- Stay on the operator's current branch unless they instruct otherwise.
- Do not commit, push, or open a PR as part of this plan.
- If the operator later asks for a commit, recent history uses short Conventional Commit subjects such as `fix: dead code` and `refactor: github auth flow`.

## Steps

### Task 1: Create a production-safe encryption helper for env vars

- [ ] **Step 1: Add `src/lib/crypto.ts`**
  Create a small helper module for encrypting and decrypting JSON payloads with the Workers Web Crypto API.

  Required behavior:

  - Derive a non-extractable AES-GCM 256-bit key from `BETTER_AUTH_SECRET` using `crypto.subtle.importKey()` plus PBKDF2 with SHA-256.
  - Use a **random salt per encrypted payload** and a **random 12-byte IV per encrypted payload**.
  - Store enough metadata with the ciphertext to decrypt later. Use a versioned string format so the encoding can evolve safely, for example `v1.<salt>.<iv>.<ciphertext>`.
  - Use ASCII-safe encoding for each binary segment. Do not use `String.fromCharCode(...largeUint8Array)` spreads.
  - Export helpers that keep the router code simple. One good shape is:

  ```ts
  export async function encryptText(plaintext: string, secret: string): Promise<string>
  export async function decryptText(payload: string, secret: string): Promise<string>
  ```

  Implementation guidance:

  - Keep the file self-contained; no Node-only crypto APIs.
  - Throw a clear error for malformed payloads or unsupported versions.
  - The helper is for at-rest encryption in D1, not for client-visible secrets or transport encryption.

  Why this shape:

  - Cloudflare Workers fully supports `crypto.subtle`, including AES-GCM and PBKDF2.
  - AES-GCM gives authenticated encryption, which is the right default here.
  - A per-payload salt avoids deriving the same key material for every encrypted row from the same app secret.

**Verify**: `pnpm exec tsc --noEmit` -> exits 0.

---

### Task 2: Add the `projects` table and generate a migration

- [ ] **Step 1: Extend `src/db/schema.ts` with a `projects` table**
  Add a new app-owned table for persisted projects.

  Required columns:

  ```ts
  id: text("id").primaryKey()
  name: text("name").notNull()
  description: text("description")
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" })
  githubRepo: text("githubRepo")
  githubInstallationId: integer("githubInstallationId")
  sandboxId: text("sandboxId")
  status: text("status", { enum: ["provisioning", "ready", "failed"] }).notNull().default("provisioning")
  envVars: text("envVars")
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`)
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`)
  ```

  Required table details:

  - Add an index on `userId`, because `projects.list` will query by owner.
  - Keep `envVars` as the encrypted string column produced by `src/lib/crypto.ts`.
  - Do **not** add a `branch` column.
  - Do not modify the existing Better Auth tables beyond importing whatever Drizzle helpers you need.

- [ ] **Step 2: Generate the migration SQL**
  Run:

  ```bash
  pnpm db:generate
  ```

  Expected:

  - A new migration SQL file is created under `migrations/`.
  - `migrations/meta/_journal.json` and the snapshot file are updated.
  - The SQL creates the `projects` table, its foreign key to `user(id)`, and the `userId` index.

- [ ] **Step 3: Do not add a local migrate step**
  Do not run `pnpm db:migrate` and do not add it back to this plan. For this repo, Alchemy applies the generated SQL from `migrations/` on deploy/update because `alchemy.run.ts` already configures `migrationsDir` and `migrationsTable` on the D1 resource.

**Verify**: `pnpm exec tsc --noEmit` -> exits 0.

---

### Task 3: Add a `projects` router without disturbing the existing GitHub router

- [ ] **Step 1: Extend `src/integrations/trpc/router.ts`**
  Import the existing DB helper, the new schema table, Drizzle filters, `nanoid`, and the crypto helper. Keep the existing `health` and `github` routers intact.

  The new router should provide:

  - `create`
  - `list`
  - `get`

  Required input shape for `create`:

  ```ts
  z.object({
  	name: z.string().min(1),
  	description: z.string().optional(),
  	githubRepo: z.string().optional(),
  	githubInstallationId: z.number().int().positive().optional(),
  	envVars: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
  })
  ```

  Required behavior:

  - Use `createDb(ctx.env)` from `#/db`.
  - Trim `name` before insert and reject an empty post-trim value.
  - Treat `githubRepo` and `githubInstallationId` as a pair: if one is present without the other, throw `BAD_REQUEST`.
  - Sanitize `envVars` before encryption. At minimum, drop rows whose `key.trim()` is empty.
  - If sanitized env vars remain, `JSON.stringify()` them and encrypt them with `encryptText(..., ctx.env.BETTER_AUTH_SECRET)` before insert.
  - Insert the project with `status: "provisioning"` and `branch` omitted entirely.
  - `list` must only return projects owned by `ctx.user.id`.
  - `get` must only return a project belonging to `ctx.user.id`. Prefer a user-scoped query (for example by combining `id` and `userId`) so the procedure does not leak whether another user's project id exists.
  - Register the new router as `projects: projectsRouter` on the root router alongside the existing `health` and `github` routers.

  Return-shape guidance:

  - Do **not** send the encrypted `envVars` blob back to the client from `create`, `list`, or `get`.
  - Return project metadata only. If needed, map the inserted/selected row to an object that omits `envVars`.

  Pseudocode shape:

  ```ts
  const projectsRouter = {
  	create: protectedProcedure.input(...).mutation(async ({ ctx, input }) => {
  		const db = createDb(ctx.env);
  		const id = nanoid();
  		const encryptedEnvVars = ...;

  		const [project] = await db
  			.insert(projects)
  			.values({
  				id,
  				name: trimmedName,
  				description: input.description,
  				userId: ctx.user.id,
  				githubRepo: input.githubRepo,
  				githubInstallationId: input.githubInstallationId,
  				status: "provisioning",
  				envVars: encryptedEnvVars,
  			})
  			.returning();

  		return toProjectResponse(project);
  	}),
  } satisfies TRPCRouterRecord;
  ```

  Keep the implementation minimal. Add one small local response-mapping helper only if it clearly improves readability.

**Verify**: `pnpm build` -> exits 0.

## Test plan

Do not introduce a new automated test setup in this plan.

Instead, verify the change with the existing repo checks:

- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- Inspect the generated migration SQL to confirm the new table, foreign key, and index are present.

## Done criteria

All of the following must hold:

- [ ] `src/lib/crypto.ts` exists and provides working AES-GCM helpers based on `crypto.subtle`
- [ ] `src/db/schema.ts` exports a `projects` table with no `branch` column
- [ ] `pnpm db:generate` creates a new migration for the `projects` table
- [ ] `src/integrations/trpc/router.ts` still exports the existing `health` and `github` routers and now also registers `projects`
- [ ] `create`, `list`, and `get` are all protected procedures scoped to the authenticated user
- [ ] No `create`, `list`, or `get` response exposes the encrypted `envVars` blob
- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm build` exits 0
- [ ] No out-of-scope files are modified, other than generated files under `migrations/`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The code in `src/db/schema.ts` or `src/integrations/trpc/router.ts` no longer matches the excerpts in "Current state".
- `pnpm db:generate` rewrites or invalidates existing migrations instead of creating the expected additive migration.
- Implementing the router cleanly requires changes to `src/components/new-project-dialog.tsx` or Plan 003 files.
- The current runtime environment cannot support the required Workers Web Crypto APIs without adding a Node-only fallback.
- The operator wants encrypted env vars to be readable by the client; that would require a different design and should not be improvised here.

## Maintenance notes

- Plan 003 should build on this schema and router instead of re-defining project persistence.
- If project statuses grow beyond sandbox lifecycle states, revisit the `status` enum before more callers depend on it.
- If secret rotation is added later, the versioned ciphertext format from `src/lib/crypto.ts` gives a place to introduce re-encryption or multi-key decrypt logic.
- Reviewers should pay closest attention to user scoping in `get`/`list` and to whether any response accidentally returns encrypted env-var data.
