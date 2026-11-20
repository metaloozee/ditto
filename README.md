# Ditto

Ditto starts with the single-page TanStack Start template. The pnpm workspace contains the React and Tailwind app in `apps/web` and the Alchemy stack at the repository root.

## Getting started

Use the Node.js version in `.node-version` and the pnpm version pinned in `package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm exec alchemy profile edit --add Cloudflare
pnpm exec vp run dev
```

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
