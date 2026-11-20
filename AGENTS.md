## Design system

Before any UI change in `apps/web` (a component, route, style, token, or copy), read `DESIGN.md` and follow its tokens, components, and Do's and Don'ts. The code is the source of truth: tokens live in `apps/web/src/styles.css`, components in `apps/web/src/components/ui/`, and the `/design` route renders all of them. When you change a token or component, update `DESIGN.md` in the same change.

`DESIGN.md` is a symlink to `apps/web/public/design.md`, which the app serves at `/design.md`. Edit through either path.

## Agent skills

### Issue tracker

GitHub Issues on `metaloozee/ditto`, via `gh`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.
