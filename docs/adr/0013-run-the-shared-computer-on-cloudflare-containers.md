---
status: accepted
---

# Run the shared computer on Cloudflare Containers, one screen per bot

Each workspace's shared computer is a Cloudflare Container that the workspace's Durable Object owns through Cloudflare's `@cloudflare/containers` library. The computer gives every bot its own screen: a full desktop with its own keyboard and mouse, not only a browser. Bots work at the same time, and none waits for another; one can test a website while another applies to jobs. All screens share one disk, so bots share the computer's files and logins. The owner can watch any screen live or take it over (ADR-0007). Ditto builds the computer-use actions (screenshot, click, type, drag) itself, on the screens inside the Container. We chose this because Ditto is open source and self-deployed on the owner's Cloudflare account. The computer must run Ditto's own image and egress filter (ADR-0004). And bots that share one computer must share its logins.

## Considered options

- **E2B Desktop.** A ready computer-use API, view-only and interactive streams, and pause and resume that keep memory and disk. Rejected because:
  - It streams one screen per sandbox, so one screen per bot would mean one sandbox per bot, and bots would no longer share logins.
  - It cannot be self-hosted, so every self-deployed Ditto would need an E2B account, and owners' private logins would sit with a third company.
  - Its domain rules cover only ports 80 and 443, where Ditto's filter decides and logs every request per workspace.
  - Sessions are capped at 1 hour on its free plan and 24 hours on Pro.
- **Cloudflare Sandbox SDK.** The same Containers with a coding-sandbox API (commands, files) on top. It adds nothing for screens and has the same lifetime rules.
- **cloudflare/computer.** A virtual file system stored in a Durable Object, with ways to run commands. It has no screen, input or stream. It may later hold bots' files.
- **Cloudflare Browser Run.** Rejected in ADR-0012: Google refused its sign-in, and it lost HTTP/2.
- **Fly.io Machines.** A full VM that runs Ditto's image, with volumes that survive stops. Kept as the fallback if Containers cannot hold a working computer, at the cost of a second provider.

## Consequences

- Cloudflare stops an instance once its Durable Object is idle. Only Worker requests, alarms, streamed responses and WebSockets the object accepts count as activity, so a bot's DevTools or screen traffic must pass through the object, not straight through to the instance (measured 2026-11-23, #37). `@cloudflare/containers` renews activity on WebSocket messages. While nothing holds the computer, it stops.
- A Container's disk is discarded when it stops, so logins survive only through the cookie save and restore (#37) or Containers' disk snapshots.
- How many bots can work at once is bounded by how many screens fit in one instance. That number is measured in #37 and not yet committed.
- Taking over one screen must stop every bot from observing or operating that screen. Other bots keep working on their own screens.
- A browser profile can be open in only one browser at a time, and many desktop apps lock their data the same way. So each screen's browser has its own profile, and the shared computer keeps one store of the workspace's logins that it copies into every screen's browser. A login made on any screen reaches every bot. A site that rotates its session or binds it to one browser can refuse a copied login; the #37 restore runs measure this for Google and LinkedIn.
