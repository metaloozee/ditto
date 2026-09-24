# 003 execution evidence (not self-approval)

Worktree: `/home/ayan/ditto-worktrees/plan-003-grok`
Base: detached `d18bf57` (`d18bf57855f2cfa8179adb3395a3ac544e5eca36`)
Nothing staged, committed, merged, pushed, or deployed.

## T01–T07

| ID | Where | Limit |
|---|---|---|
| T01 | `session-command.test.ts` mocked-auth handler | ownership/archive/migrating/blocked/deleting; zero rows; no deliver/control |
| T02 | same file | model unconfigured / invalid thinking; zero rows |
| T03 | same file | first-session atomic admit, identical retry IDs including after model outage, thinking default hash, payload conflict |
| T04 | same file | D1 batch rollback at statements 0–8; concurrent same-key one command |
| T05 | `session-command-delivery.test.ts` | delivery uses persisted command ids; expire/reclaim/failWork do not mutate trusted work |
| T06 | same file, labeled delivery-only | lost ack redelivers same ids; predecessor delivered first. Coordinator consumption BLOCKED until 004 |
| T07 | same file, labeled delivery-only | cancel/stop delivered; messages stay complete/pending; work stays queued. Coordinator cancel advancement BLOCKED until 004 |

Receipts stay `admitted`, never `running`.

## Commands

See sibling logs. Final: contracts 14; web 70 files / 736 tests; runtime 20; brain 43; runner 79. `pnpm check` 11 warnings. Paid topology NOT RUN.
