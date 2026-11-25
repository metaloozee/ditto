---
status: accepted
---

# Ask the owner in chat before the shared computer reaches a new site

A new workspace's approved sites start empty, so the shared computer reaches nothing. When the filter blocks a site, the bot pauses the task and asks the owner in the conversation. The owner can allow that one site, allow a site set, paste a list or allow every site. We chose asking at the moment of need over approving sites ahead of time: an approval made in advance opens an exit the owner never chose, and ADR-0004 rests on the shared computer holding private logins.

Allowing every site keeps saved logins working. While it is on, ADR-0004's guarantee does not hold: any page the shared computer opens can act as the owner on their signed-in accounts. The owner chose this over turning logins off, and the prompt says so before they confirm. Choosing a set or a list afterwards brings the restriction back once the fence is verified again.

## Consequences

- The site named in the prompt is the host the filter blocked, read from its record, never a name the bot supplies. A page cannot steer the bot into asking for an exit of its choosing.
- A pasted list is the bot's reading of the owner's words, so the owner sees and confirms the exact sites before any is allowed.
- A change to the approved sites reaches a running shared computer without a restart. The browser user inside it must not be able to make that change, so the path runs from the Workspace object to the filter, not through the control port.
- Site sets list exact sites, including the sign-in and asset sites a service needs, because the filter matches exact hosts.
