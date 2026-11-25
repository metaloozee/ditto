# Two workspaces' fences on a deployed stage (#47)

Local Docker withholds `NET_ADMIN`, so the local suite cannot show that the fence holds, or that one workspace's approved sites are denied to another. This procedure shows both once, on a disposable stage on Workers Paid, using only routes a real stage serves. Nothing here needs `TEST_HOOKS` or the feasibility stacks.

It deploys to the owner's Cloudflare account and runs billed instances. There is no spending cap: the stage's instance limit of 2 is the only bound, and each instance is destroyed an hour after its start regardless.

## 1. Prepare the stage

Use a stage name other than `test`. The `test` stage binds the test hooks and fake sign-in providers. This procedure uses `fence-check`, whose Worker is `ditto-app-fence-check`.

Write `.env.fence-check` at the repository root. It is gitignored like `.env`.

| Setting                                    | Value                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `BETTER_AUTH_URL`                          | `https://ditto-app-fence-check.<workers subdomain>.workers.dev`                      |
| `BETTER_AUTH_SECRET`                       | `openssl rand -base64 32`                                                            |
| `COOKIE_ENCRYPTION_KEY`                    | `openssl rand -base64 32`                                                            |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | A GitHub OAuth app with callback `<BETTER_AUTH_URL>/api/auth/callback/github`        |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | A Google OAuth client with redirect URI `<BETTER_AUTH_URL>/api/auth/callback/google` |
| `RESEND_API_KEY`, `RESEND_FROM`            | Only needed if an account signs in with an email code                                |
| `COMPUTER_MAX_INSTANCES`                   | `2`                                                                                  |

## 2. Deploy

```sh
pnpm exec alchemy plan --stage fence-check --env-file .env.fence-check
pnpm exec alchemy deploy --stage fence-check --env-file .env.fence-check
```

`alchemy.run.ts` binds `TEST_HOOKS` and the fake-provider settings only on the `test` stage, and takes the instance limit from `COMPUTER_MAX_INSTANCES`. After the deploy, check in the dashboard that the `workspace` container application allows at most 2 instances.

## 3. Sign in as two accounts

Use two separate browser profiles, for example GitHub in one and Google in the other. In each profile:

1. Sign in at `BETTER_AUTH_URL`.
2. In DevTools, copy the request `Cookie` header from any request to the site.
3. Open the workspace, which provisions it on first use, and note its ID:

```sh
APP=https://ditto-app-fence-check.<workers subdomain>.workers.dev
A_COOKIE='<cookie header of account A>'
B_COOKIE='<cookie header of account B>'
curl -s -X POST -H "cookie: $A_COOKIE" "$APP/api/workspaces/open"   # note workspaceId as A
curl -s -X POST -H "cookie: $B_COOKIE" "$APP/api/workspaces/open"   # note workspaceId as B
```

The commands below call each account's workspace as `$APP/api/workspaces/$A` and `$APP/api/workspaces/$B`.

## 4. Check the bindings

```sh
curl -s -H "cookie: $A_COOKIE" "$APP/api/workspaces/$A/bindings"
```

Every entry must read `resolved`: `DB`, `WORKSPACE`, `BOT`, `CREDENTIALS`, `FILES` and `COOKIE_ENCRYPTION_KEY`. The answer never contains the key itself.

## 5. Give each workspace different approved sites

```sh
curl -s -X PUT -H "cookie: $A_COOKIE" -H 'content-type: application/json' \
  -d '{"hosts":["example.com"]}' "$APP/api/workspaces/$A/hosts"
curl -s -X PUT -H "cookie: $B_COOKIE" -H 'content-type: application/json' \
  -d '{"hosts":["example.org"]}' "$APP/api/workspaces/$B/hosts"
```

## 6. Start both computers

```sh
curl -s -X POST -H "cookie: $A_COOKIE" "$APP/api/workspaces/$A/computer/start"
curl -s -X POST -H "cookie: $B_COOKIE" "$APP/api/workspaces/$B/computer/start"
```

Each answer must show `"isolation": {"policy": true, "fence": true, ...}` and `"privateSessions": {"available": true}`. If either reports `fence-absent`, record that, skip to step 9, and see [If the fence is absent](#if-the-fence-is-absent).

## 7. Cross-check the sites

`reach` loads `https://<host>/` on the computer, through its filter, as Chrome would, and returns the filter's decision.

```sh
reach() { curl -s -X POST -H "cookie: $1" -H 'content-type: application/json' \
  -d "{\"host\":\"$3\"}" "$APP/api/workspaces/$2/computer/reach"; echo; }
reach "$A_COOKIE" "$A" example.com   # decision allow, status 200
reach "$A_COOKIE" "$A" example.org   # decision deny
reach "$B_COOKIE" "$B" example.org   # decision allow, status 200
reach "$B_COOKIE" "$B" example.com   # decision deny
reach "$B_COOKIE" "$A" example.com   # 404: B cannot use A's computer
```

## 8. Check a file is served only to its owner

Files live in the stage's R2 bucket at `<workspaceId>/<kind>/<name>`. Sign Wrangler in to the same account first (`pnpm dlx wrangler login`, or set `CLOUDFLARE_API_TOKEN`). If the login reaches more than one account, Wrangler refuses to guess: set `CLOUDFLARE_ACCOUNT_ID` to the account Alchemy deployed to (`pnpm exec alchemy profile show`). The bucket's name is `bucketName` in `.alchemy/state/ditto/fence-check/files.json`. Then seed one file for A:

```sh
echo 'fence check' > /tmp/fence-check.txt
pnpm dlx wrangler r2 object put "<bucket>/$A/published/fence-check.txt" \
  --file /tmp/fence-check.txt --content-type text/plain --remote
curl -s -o /dev/null -w '%{http_code}\n' -H "cookie: $A_COOKIE" \
  "$APP/api/workspaces/$A/files/published/fence-check.txt"   # 200
curl -s -o /dev/null -w '%{http_code}\n' -H "cookie: $B_COOKIE" \
  "$APP/api/workspaces/$A/files/published/fence-check.txt"   # 404
```

## 9. Stop and tear down

```sh
curl -s -X POST -H "cookie: $A_COOKIE" "$APP/api/workspaces/$A/computer/stop"
curl -s -X POST -H "cookie: $B_COOKIE" "$APP/api/workspaces/$B/computer/stop"
pnpm dlx wrangler r2 object delete "<bucket>/$A/published/fence-check.txt" --remote
pnpm exec alchemy destroy --stage fence-check --env-file .env.fence-check
```

`alchemy destroy` leaves the stage's image in the container registry. Delete it:

```sh
pnpm dlx wrangler containers images list   # find ditto-workspace-fence-check-<suffix>:<tag>
pnpm dlx wrangler containers images delete "ditto-workspace-fence-check-<suffix>:<tag>"
```

Then confirm nothing billable is left from the stage: no `ditto-app-fence-check` Worker, and no container application, image, D1 database, R2 bucket or Durable Object namespace from the stage. `wrangler containers list`, `wrangler d1 list` and `wrangler r2 bucket list` show each. Delete the two OAuth apps if they were made for this run.

## 10. Record the outcome

Comment on #47 with one entry in the [evidence format](evidence.md). Include the date, the stage, the package versions from `package.json` (`alchemy`, `@alchemy.run/cloudflare`, `@cloudflare/containers`) and the Wrangler version, and each step's observed answer with workspace IDs and cookies redacted.

## If the fence is absent

Leave #47 open. Link it to the decision record's [If filtered traffic is unsuitable](decision-record.md#if-filtered-traffic-is-unsuitable) section, which compares the alternatives, including Cloudflare's `enableInternet: false` with outbound intercepts, and to ADR-0013's Fly.io fallback.
