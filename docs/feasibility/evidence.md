# Evidence entries

Each trial observation becomes one entry under the matching section of [decision-record.md](decision-record.md). Append entries in date order. Never edit an earlier entry. If an observation is later found to be wrong, add a new entry that says so.

## Format

```md
#### YYYY-MM-DD · <route> · <outcome>

- **Route:** what was exercised, end to end
- **Runtime:** the pinned runtime and its version, such as Pi `@earendil-works/pi-ai` 1.6.0, when a runtime is involved
- **Date:** YYYY-MM-DD, plus a time and timezone when repeats on one day matter
- **Network origin:** where the request left from: `home network`, `local Worker (alchemy dev)`, `deployed Worker`, `container`
- **Expected:** what should happen if the route works
- **Observed:** what happened, with status codes and redacted error text
- **Retries:** each retry's time and result
- **Fallback:** the route selected if this one fails, or `none needed`
```

`<outcome>` is one of `pass`, `fail` or `blocked`. A desktop workflow uses `pass`, `works with take-over` or `unsupported` (see ADR-0004).

## Redaction

An entry must contain no secret, token, cookie, account identifier, email address or private hostname. Replace each one with a placeholder in angle brackets that names what was removed, such as `<access token>` or `<account id>`. Keep status codes, error codes, timings and public hostnames, which the decision depends on.

## Example

This entry is illustrative. It records no real trial.

#### 2026-11-20 · OpenAI Responses refresh from home network · pass

- **Route:** refresh an expired ChatGPT plan access token, then send one Responses request with the new token
- **Date:** 2026-11-20, 14:05 UTC
- **Network origin:** home network
- **Expected:** refresh returns a new access token. The next Responses request returns 200 with a streamed completion.
- **Observed:** refresh returned 200 with `<access token>` and `<refresh token>`. Responses returned 200 and streamed 42 output tokens in 1.8s.
- **Retries:** 14:20 UTC pass, 14:35 UTC pass
- **Fallback:** none needed
