## Design system

Before any UI change in `apps/web` (a component, route, style, token, or copy), read `DESIGN.md` and follow its tokens, components, and Do's and Don'ts. The code is the source of truth: tokens live in `apps/web/src/styles.css`, components in `apps/web/src/components/ui/`, and the `/design` route renders all of them. When you change a token or component, update `DESIGN.md` in the same change.

`DESIGN.md` is a symlink to `apps/web/public/design.md`, which the app serves at `/design.md`. Edit through either path.

## Verification

The full suite (`vp test run`) takes about 10 minutes, most of it the `auth` browser tests. Scope each run to the change:

- **A ticket**: `vp check`, plus the test files it adds or changes: `pnpm exec vp test run --project <project> <file>`. The projects are in `vite.config.ts`.
- **A whole project**, when the change reaches code its tests share: `auth` for sign-in, sessions, account linking and the Better Auth configuration; `workspace` for the workspace gateway and its Durable Objects; `feasibility` for `feasibility/`. A change to `apps/web/tests/auth/setup.ts` runs `auth` and `workspace`, which share its test stage.
- **The full suite** (`vp run verify`): once per spec, before its last ticket merges.

When writing a spec or ticket, name the test files that verify it.

## Agent skills

### Issue tracker

GitHub Issues on `metaloozee/ditto`, via `gh`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.
