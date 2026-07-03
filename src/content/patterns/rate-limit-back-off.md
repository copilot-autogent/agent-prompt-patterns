---
title: "Rate-Limit Back-Off"
category: "agent-autonomy"
evidenceLevel: "moderate"
summary: "When a tool call returns a rate-limit error (HTTP 429), apply structured exponential back-off with jitter before retrying rather than retrying immediately or aborting. Immediate retries amplify quota exhaustion; immediate aborts discard work that a short wait would have recovered."
relatedPatterns: ["circuit-breaker", "tool-error-triage", "uncertainty-gated-irreversible-action"]
tags: ["rate-limiting", "backoff", "retry", "429", "api", "resilience", "exponential-backoff", "jitter", "error-handling"]
---

## Problem

When agents call external APIs at pace — pushing commits, posting comments, creating issues, or querying language-model endpoints — they encounter rate limits. The typical responses are wrong in opposite ways.

**Immediate retry** treats a 429 as a temporary glitch and resubmits the call instantly. For secondary rate limits (per-minute caps on mutation counts), this restarts the quota window from scratch on every retry. The agent can burn its remaining quota in seconds and extend the lockout well past the original window.

**Immediate abort** treats a 429 as a fatal error. The work is discarded. The user receives an error for a condition that would have resolved on its own in under a minute. In sprint agents that make dozens of sequential API calls, a single unhandled 429 aborts the entire run.

Neither strategy distinguishes rate-limit errors from other error classes. A 429 is not a 403 (auth failure) or a 5xx (server error). Each requires a different response. Treating them uniformly produces the wrong behavior for at least two of the three cases.

The root cause: agents have no structured back-off policy for the specific case where the API is functioning correctly but the caller has exceeded its quota.

## Context

This pattern applies whenever:

- An agent makes repeated calls to a rate-limited external API (version control hosts, AI model endpoints, package registries, CI systems)
- Calls can arrive in bursts — multiple tool invocations in a single session or concurrent agents sharing a token
- The agent makes API writes (pushes, comments, issue mutations) that are subject to secondary rate limits stricter than the read quota

It applies to both sequential agents (single agent, many calls) and parallel agents (multiple agents, shared token). Parallel agents are a stronger case: synchronized retries after a 429 produce a retry storm that re-triggers the rate limit as soon as the window clears.

The pattern does **not** apply to:

- **403 (auth)**: the request is rejected on grounds unrelated to quota; retrying will not help and may lock the credential
- **404 (not found)**: the resource does not exist; back-off cannot create it
- **5xx (server error)**: the upstream is failing; a single fixed-delay retry is appropriate, not an escalating back-off loop
- **Timeouts**: a single retry is appropriate; escalate if repeated

Use the **Tool Error Triage** pattern to classify the error type before deciding whether to enter the back-off loop.

## Solution

**Apply exponential back-off with jitter when a rate-limit error is received, and escalate after a fixed number of consecutive failures.**

### Algorithm

```
on rate_limit_error(e):
  retry_count = 0
  delay = base_delay  # 1–2 s

  while retry_count < max_retries:  # max_retries ≈ 5; loop runs 5 retry attempts
    # Honor Retry-After if present; cap it at max_delay to bound wait time
    server_wait = parse_retry_after(e.headers)  # seconds; None if absent
    if server_wait is not None:
      delay = min(max(delay, server_wait), max_delay)

    wait_time = delay * uniform(0.8, 1.2)   # ±20% jitter applied after floor
    sleep(wait_time)

    result = retry_call()
    if result.ok:
      return result

    if result.status != 429:
      # Error type changed — hand off to Tool Error Triage
      return tool_error_triage(result)

    delay = min(delay * 2, max_delay)  # cap at max_delay ≈ 60 s
    retry_count += 1

  # Escalate after max_retries consecutive 429s (original call + max_retries retries)
  escalate(
    error = last_error,
    total_wait_seconds = sum of all sleep() calls,
    retry_count = max_retries,
    suggested_retry = "wait ~{max_delay} s before retrying manually"
  )
```

**Parameters**:

| Parameter | Value | Rationale |
|---|---|---|
| `base_delay` | 1–2 s | Enough to let a per-second bucket reset; small enough to be invisible to users |
| `jitter` | ±20% | Desynchronizes parallel agents sharing a token; reduces retry storms |
| `multiplier` | 2× per retry | Standard exponential growth; reaches `max_delay` in 6 doublings from a 1s base — with `max_retries`=5 the cap acts as a safety ceiling for higher `base_delay` values rather than a value routinely reached |
| `max_delay` | 60 s | Most per-minute quota windows fully reset within 60 s; longer waits rarely help |
| `max_retries` | 5 | Bounds total wait time to ~2 min; beyond that, escalate rather than burn session time |

### Decision table

Before entering the back-off loop, classify the error. Back-off applies only to 429.

| Error | Action |
|---|---|
| **429 / "rate limit exceeded" / "secondary rate limit"** | Exponential back-off → retry (this pattern). Note: some APIs (including older GitHub API versions) return 403 with a "secondary rate limit" body — check the response body text, not only the HTTP status, before aborting on a 403. |
| **403 (auth/forbidden)** | Abort immediately; escalate with token scope suggestion. **Exception**: if the response body contains "secondary rate limit", treat as 429 and enter back-off (see above). |
| **5xx (server error)** | Single retry after fixed 15–30 s delay; escalate if repeated |
| **Timeout** | Single retry; abort if repeated |
| **Any other 4xx** | Abort; fix the call |

### Escalation message format

When `max_retries` is exhausted, produce a structured escalation rather than an unformatted error:

```
Rate limit escalation after 5 consecutive 429s:
- Last error: <exact error message>
- Total wait time: <total_wait_seconds> s across <retry_count> retries
- API endpoint: <endpoint>
- Suggested action: wait approximately 60 s, then retry manually
- If this recurs: consider reducing burst call rate or splitting work across tokens
```

Include enough context for the user to act without re-running the agent from scratch.

### Parallel agent considerations

When multiple agents share a single API token and one hits a 429, the others are likely close behind. If your orchestrator has a shared state mechanism (e.g., a persistent storage entry the agents can read/write), set a "rate-limited until T" flag when a 429 is received, keyed by token and API scope so unrelated traffic using different credentials is not stalled. Update the flag monotonically (`until = max(existing_T, new_T)`) so a racing agent cannot shorten an ongoing cooldown. Other agents check the flag before making calls and wait until T passes before their next call to the same endpoint. This prevents the retry storm that synchronized back-off creates when many agents start retrying at nearly the same time.

If no shared flag mechanism exists, ensure each agent uses independently-seeded jitter. The ±20% jitter on each agent's delay schedule is sufficient to desynchronize retries for small agent pools (2–5 agents). For larger pools, increase jitter to ±50%.

## Evidence

**GitHub secondary rate limits observed in sprint agents**: sprint agents that POST issue comments and push commits in rapid succession have hit GitHub's secondary rate limits, which cap per-minute mutation counts. Observed symptom: 429 responses mid-sprint, agents aborted without completing the remaining commit or comment steps. A fixed wait (non-exponential, not capped) was added ad-hoc to two sprint prompts; it recovered the sprint but did not generalize. This pattern generalizes the ad-hoc fix.

**GitHub API documentation**: GitHub's REST API documentation explicitly states a secondary rate limit on the number of API mutations per minute. The documentation recommends waiting at least one second between mutating requests and honoring `Retry-After` headers when present. This is consistent with the `base_delay` = 1–2 s parameter; the exponential growth and cap are required additions for burst scenarios where a single-second delay is insufficient.

**Retry storm failure mode**: multiple sprint agents triggered simultaneously have produced a scenario where a 429 cleared on one agent while other agents were mid-retry — causing another 429 immediately after the first cleared. The jitter mechanism was introduced to address this; ±20% variation ensures agents that started retrying at the same time are no longer synchronized after one or two retry cycles.

**Evidence level: moderate** — pattern is derived from observed incidents, API documentation, and a generalizable fix applied successfully to specific sprint prompts. Not yet validated in a controlled experiment across different API providers.

## Tradeoffs

**Benefit**: Recovers from rate-limit conditions without human intervention. The total bounded wait time across 5 retries is approximately 30–60 s (1+2+4+8+16 s with `base_delay`=1s; 2+4+8+16+32 s with `base_delay`=2s), which is typically shorter than the manual intervention loop (user reads error → waits → reruns agent). Escalation with explicit retry guidance ensures the user can act if the back-off is exhausted.

**Cost**: Back-off retries add latency to sprint runs. A sprint that hits a 429 waits approximately 1–300 s additional (best case: single retry at `base_delay`≈1s; worst case: all 5 retries at `max_delay`=60s each) before completing the affected call. For time-sensitive sprints, this is a real cost. Mitigation: callers can pass a `max_retries=1` override if latency is more important than recovery.

**Watch out for**:

- **Misclassifying 403 as 429**: Some APIs return a 403 for "secondary rate limit exceeded" instead of 429. Check the error message body for "secondary rate limit" language, not just the HTTP status code, before entering back-off. This is also reflected in the decision table above. Example: older GitHub API versions returned 403 with a "secondary rate limit" body for secondary rate limit hits.
- **`Retry-After` header drift**: Honor the `Retry-After` header if present, but only as a floor — some APIs set very conservative `Retry-After` values (e.g., 300 s) for secondary limits. Use `max(Retry-After, base_delay)` as the starting point and do not bypass `max_delay` for the header value.
- **Write operation idempotency**: If a 429 occurs after the API accepted the write but before returning a success response, retrying may duplicate the write. Before retrying a write operation after a 429, check whether the resource was already created (e.g., re-fetch the PR list, comment list, or commit log). If already applied, skip the retry.
- **Quota amplification across agents**: Jitter desynchronizes retries but does not reduce total call volume. If many agents are retrying, the aggregate call rate during the retry window may be high enough to re-trigger the limit. The shared-flag mechanism described in the solution section is the correct fix for large agent pools.
- **Exponential back-off on non-rate-limit transients**: Do not apply this pattern's exponential schedule to 5xx or timeout errors. 5xx errors require a flat retry with a single modest delay; they do not benefit from exponential growth. Mixing the two schedules produces unnecessarily long waits for server errors that would have cleared on a 15-second retry.

## Related Patterns

- **[Tool Error Triage](/agent-prompt-patterns/patterns/tool-error-triage)** — classify every tool error before deciding whether to back off, retry flat, or abort; rate-limit back-off is the correct response for the "429 / transient / external" cell of the error classification matrix, not for the entire error space
- **[Circuit Breaker for Recurring Agent Tasks](/agent-prompt-patterns/patterns/circuit-breaker)** — complements rate-limit back-off at a higher level: the circuit breaker detects repeated failures across full task runs, while rate-limit back-off handles the recovery within a single call; five consecutive back-off escalations in a recurring task are a signal that the circuit breaker threshold should be lowered
- **[Uncertainty-Gated Irreversible Action](/agent-prompt-patterns/patterns/uncertainty-gated-irreversible-action)** — rate limits on write operations deserve extra caution; confirm write idempotency before retrying a timed-out write that may have partially committed before the 429 was returned
