---
status: rejected
---

# Run the browser on Browser Run

A Cloudflare Container's disk is discarded whenever the instance stops, and Cloudflare stops idle instances within minutes, so a browser inside the workspace's sandbox needs keep-alives, a hand-built egress fence and its own sizing. The workspace's browser therefore runs on Cloudflare Browser Run, driven over CDP by Ditto's own harness, with the workspace's destination list as the session's Browser Run guardrails. The Cloudflare Container remains the sandbox, holding the workspace's files and running scripts that bots write.

While a session is alive, the Workspace Durable Object keeps its session ID and reconnects to it, so tabs and cookies carry over between requests. A session still ends after at most 20 minutes without a command, on a crash, or when Browser Run recycles it for a release, and Browser Run keeps no login state after that. So Ditto keeps it: the Workspace Durable Object exports the browser's cookies over CDP after each hand-back and before an idle session would close, stores them encrypted, and restores them into the next session. This decision stays proposed until a trial shows that restored cookies keep representative logins and that guardrails can enforce each workspace's list.

## Rejected (2026-11-23)

The #36 trial ran this design on Cloudflare and the browser stays in the workspace's sandbox. Google refused the sign-in in Browser Run's browser after the email step, where the same login passed with take-over from a Cloudflare Container (#32). Chrome under guardrails negotiated only HTTP/1.1, where the Container's filter carried HTTP/2. LinkedIn worked on both. A second browser provider also adds a dependency and its limits (50 guardrail hosts, Live View links as credentials) for no capability the sandbox lacks. The problem this ADR set out to solve remains: a Container's disk is discarded when the instance stops, so the sandbox browser loses its logins. The cookie export and restore described above does not depend on Browser Run. The Workspace Durable Object can apply it to the sandbox's browser instead. See the Desktop provider section of `docs/feasibility/decision-record.md`.

## Consequences, had it been accepted

- Guardrails allow at most 50 hosts and are fixed for a session, so changing a workspace's list takes effect in its next session, and a workflow that needs more hosts is unsupported on Browser Run (ADR-0004).
- Browser Run's traffic is always identified as bot traffic, so sites may challenge sign-ins more often than from a container.
- The browser's CDP connection and Live View URL each grant full control of a signed-in browser. They stay in the Workspace Durable Object and the harness, never in the sandbox, so a bot-written script cannot drive the browser.
- A read-only Live View does not stop automation. During take-over (ADR-0007), Ditto's harness must stop every bot action on the browser itself.
- Deleting a specialist (ADR-0010) must delete its stored cookies.
- The sandbox no longer holds signed-in sessions, but scripts it runs still need their own egress policy.
