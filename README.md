# Ditto

Ditto starts with the single-page TanStack Start template. The pnpm workspace contains the React and Tailwind app in `apps/web` and the Alchemy stack at the repository root.

## Getting started

Use the Node.js version in `.node-version` and the pnpm version pinned in `package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm exec alchemy profile edit --add Cloudflare
cp .env.example .env
pnpm exec vp run dev
```

Fill in `.env` before running `dev`. The Worker reads these settings at startup and stops if one is missing:

| Setting                                    | What it is                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_URL`                          | The stage's public origin, such as `http://localhost:1337`. Its port is also the local dev port, so OAuth callbacks match. |
| `BETTER_AUTH_SECRET`                       | A random secret that signs sessions and hashes email codes. Generate one with `openssl rand -base64 32`.                   |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | A GitHub OAuth app whose callback URL is `<BETTER_AUTH_URL>/api/auth/callback/github`.                                     |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | A Google OAuth client whose redirect URI is `<BETTER_AUTH_URL>/api/auth/callback/google`.                                  |
| `RESEND_API_KEY`, `RESEND_FROM`            | A Resend API key, and a sender on a domain verified in Resend, such as `Ditto <sign-in@example.com>`.                      |

`.env` is gitignored. Alchemy loads it from the repository root; pass `--env-file <path>` to use another file. The browser auth tests start their own `test` stage with fake providers and need none of these values.

`vp run dev` runs the Worker locally through Alchemy. To start TanStack Start's Vite server directly, run `pnpm exec vp -C apps/web dev`. Edit `apps/web/src/routes/index.tsx` to change the homepage. The root route owns Ditto’s document metadata.

The workspace installs Vite+ locally. Prefix `vp` commands with `pnpm exec` when using the local CLI. With the global CLI, `vp install` uses the project's pnpm pin. Run project scripts with `vp run <task>`.

## Verification

```sh
pnpm exec vp run verify
```

Verification runs `vp check` (Oxfmt, Oxlint, and type checks), `vp test run` (Vitest), and the web app’s `vp build`. Use `vp fmt` to format, `vp lint` for lint diagnostics, and `vp run preview` to serve the built app. The pre-commit hook runs `vp staged` on staged JavaScript and TypeScript files.

## Cloudflare infrastructure

`alchemy.run.ts` defines one Worker per stage. Alchemy appends the selected stage to `ditto-app-`, producing names such as `ditto-app-dev`, `ditto-app-staging`, and `ditto-app-prod`. Its entry point in `apps/web/src/worker.ts` serves the TanStack Start app.

The workspace scripts target `dev`. To deploy another stage, run `pnpm exec alchemy plan --stage staging` and then `pnpm exec alchemy deploy --stage staging`, substituting the desired stage in both commands. Alchemy tracks each stage in local state under `.alchemy/`. For existing deployments, run the plan from the checkout holding the stage’s state. Applying the Worker-only stack can delete previously managed resources and their data.
