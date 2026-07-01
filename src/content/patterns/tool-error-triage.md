---
title: "Tool Error Triage"
category: "error-recovery"
evidenceLevel: "moderate"
summary: "Classify every tool error on two axes — transient vs permanent, own-domain vs external — then apply the appropriate recovery strategy. Without classification, agents either retry infinitely on permanent errors or abort immediately on recoverable ones. Both are wrong."
relatedPatterns: ["circuit-breaker", "dead-sprint-recovery", "empirical-validation-loop"]
tags: ["error-handling", "retry", "backoff", "classification", "recovery", "resilience", "transient", "permanent"]
---

## Problem

When a tool call fails, agents face what looks like a binary choice: retry or abort. In practice, neither default produces correct behavior across all error types.

**Retry-by-default** turns permanent errors into infinite loops. An agent that retries a wrong API endpoint, a revoked token, or an already-merged PR will spin until it exhausts its budget or hits a wall-clock limit. The error doesn't go away — it can't; the problem is in the call itself.

**Abort-by-default** gives up on recoverable errors. A network timeout, a 503 from an overloaded upstream, or a CAS conflict on a concurrent write will all clear on a simple retry. Agents that abort immediately lose progress they could have recovered in under a minute.

**Observed failures from this pattern's absence:**

- Auth failures mid-sprint caused agents to stop entirely rather than retrying with backoff. Multiple sprint deaths on the same day turned out to be a transient infra issue (autogent #728/#730) — backoff retries would have recovered most of them.
- CAS conflicts during concurrent manifest modification were recoverable with a single retry. Without classification, the agent either looped or aborted; a documented workaround was added ad-hoc in the #56 sprint rather than applying a general strategy.
- `get_status` returning unexpected data (always 0 checks) is a permanent semantic error — the wrong API endpoint for the query's intent. Retrying it endlessly never helps. The correct response is to abort and fix the call.

All three are distinct failure modes. All three require different responses. Without a classification step, the agent cannot distinguish them.

## Context

This pattern applies whenever:

- An agent makes tool calls that can fail for reasons outside its control (network, upstream APIs, concurrent state)
- The agent needs to decide autonomously whether to retry, wait, try an alternative approach, or escalate
- Multiple failure modes exist that require different responses

It's especially relevant in sprint agents that make many tool calls in sequence — a single unclassified error mid-sprint can either abort a recoverable run or spin indefinitely on an unrecoverable one.

The pattern does not replace domain-specific recovery logic (e.g., "if PR already merged, close the branch"). It provides the first-pass classification that determines *whether* to attempt recovery at all before delegating to domain-specific handlers.

## Solution

**Classify every tool error on two axes before deciding how to respond:**

- **Transient vs permanent**: Can the error resolve without changing the call? If yes, transient. If the call itself is wrong (wrong endpoint, wrong parameter, wrong scope), permanent.
- **Own-domain vs external**: Is the failure in infrastructure the agent controls, or in a third-party system?

### Classification matrix

| Error type | Example | Recovery |
|---|---|---|
| **Transient / own-domain** | CAS conflict, timeout on own service, rate limit | Retry with backoff (max 3) |
| **Transient / external** | GitHub API 503, DNS timeout, CI flakiness | Retry with longer backoff (max 2) |
| **Permanent / semantic** | Wrong API endpoint, unsupported parameter, wrong auth scope | Abort; fix the call itself |
| **Permanent / state** | Resource not found, branch deleted, PR already merged | Abort; re-check current state |
| **Ambiguous** | 500 Internal Server Error | Retry once; if repeated → escalate |

### Diagnostic signals per class

Classify before retrying. Don't wait for a pattern to emerge across retries.

**Transient indicators**: HTTP 429, 503, 504; "timeout"; "connection reset"; "CAS conflict"; "rate limit exceeded"

**Permanent indicators**: HTTP 422; "already exists"; "invalid parameter"; "unsupported"; "authentication failed" (wrong scope — fix the token, not the retry count). HTTP 404 is *usually* permanent but has exceptions: a newly created branch, file, or check may return 404 during an eventual-consistency window (seconds to low minutes). If a 404 occurs on a resource you just created, retry once with backoff before treating it as permanent.

**Semantic indicators**: the call *succeeds* (HTTP 200) but returns a shape that contradicts a *known domain invariant* — e.g., a CI check count that the agent just verified is non-zero now reports 0, a list the agent knows is non-empty is empty. Only flag as semantic when you have a corroborating read confirming the expectation; don't classify legitimate empty state as a programming error.

**Authentication failures**: treat as permanent-by-default when isolated (a single agent, a single tool). However, if multiple agents fail with auth errors concurrently, the correlated pattern suggests a transient infrastructure outage (not a token scope problem). In that case, apply transient/external retry logic with extended backoff (max 2) before escalating.

**Ambiguous (500)**: Could be transient or permanent. Treat as transient once; if it repeats, treat as permanent and escalate.

### Decision procedure

```
on tool_error(e):
  classification = classify(e)  # use diagnostic signals above

  if classification.is_transient:
    if retry_count < MAX_RETRIES[classification.domain]:
      wait(backoff(retry_count))
      # For write operations: re-read state before retrying to avoid duplicate
      # side effects when the upstream committed before the timeout was observed.
      if is_write_operation(e):
        confirm_not_already_applied()  # e.g., re-fetch the resource
      retry()
    else:
      escalate("Transient error not resolved after {MAX_RETRIES} retries: {e}")

  elif classification.is_permanent:
    log("Permanent error: {e}. Aborting this path.")
    try_alternative_approach() OR escalate_to_user()

  else:  # ambiguous
    if retry_count == 0:
      wait(backoff(0))
      retry_once()
    else:
      escalate("Repeated ambiguous error after retry: {e}")
```

`MAX_RETRIES`: 3 for own-domain transient, 2 for external transient.

### Backoff schedule

| Retry | Own-domain delay | External delay |
|---|---|---|
| 1st | 5s | 15s |
| 2nd | 15s | 45s |
| 3rd | 45s | — (give up) |
| Give up | Log + escalate | Log + escalate |

Backoff delays are floors, not targets. If the error message includes a `Retry-After` header or explicit wait time, honor it instead.

### Escalation vs alternative approach

When a permanent error blocks a required step, two options:

1. **Try alternative approach** — if another tool can accomplish the same goal (e.g., use REST API instead of GraphQL, fetch file contents directly instead of via search), attempt that first.
2. **Escalate to user** — if no alternative exists and the error blocks the overall task, surface it clearly: state the error class, what was tried, and what the agent cannot resolve autonomously. Don't bury a permanent error in a retry loop.

Permanent errors that are "fixable" (e.g., wrong token scope) should be escalated immediately with the specific fix stated: "Authentication failed — token lacks `repo:write` scope. Please rotate credentials." Retrying will not help and delays diagnosis.

## Evidence

**CAS conflict recovery (issue #56 sprint)**: A concurrent manifest modification caused a "CAS conflict" error during a sprint. The ad-hoc workaround — a single retry — worked immediately. This is a textbook transient/own-domain error. The workaround was correct but applied without a framework; the same logic needed to be re-derived in later sprints.

**Auth-degradation thread (autogent #728/#730)**: Multiple sprint agents died on the same day due to auth failures. Post-mortem showed the failures were a transient infrastructure issue, not permanent auth revocations. Agents that aborted immediately discarded recoverable work. With backoff retry (own-domain transient, max 3), most of those sprints would have recovered within the backoff window.

**`get_status` semantic error (CONTEXT.md gotcha)**: `get_status` was returning 0 checks permanently — not because CI was pending, but because it was querying the wrong data for the intended purpose. The fix was to change the call (use `get` and check `mergeable_state === "clean"` instead). Retrying `get_status` would never have produced the correct answer. This is a permanent/semantic error; the correct response was to abort and fix the call.

**Evidence level: moderate** — three documented instances with distinct failure modes across two projects. Pattern is generalizable; not yet validated in a controlled experiment across failure types.

## Tradeoffs

**Benefit**: Agents recover from transient errors without human intervention, and abandon permanent errors quickly without wasting budget. Both failure modes — infinite retry and premature abort — are eliminated by the classification step.

**Cost**: Classification requires judgment. An agent that misclassifies a permanent error as transient will retry it until the backoff is exhausted (max ~65s for own-domain, ~60s for external) before giving up. This is bounded waste, not infinite waste, but it's real.

**Watch out for**:

- **Misclassifying auth errors**: A single isolated "Authentication failed" usually indicates a permanent scope issue (wrong token, expired token). Retrying won't help. However, if multiple agents fail with auth errors on the same timeframe, treat it as a transient infrastructure outage (see Diagnostic signals above). The autogent #728/#730 incident is the canonical example: auth failures that looked permanent were a correlated transient infra issue. Single failure → abort; correlated failures → retry with extended backoff.
- **Retry amplification under load**: If many agents are hitting the same rate-limited upstream, simultaneous backoff retries with the same delay schedule produce synchronized retry storms. Add jitter (e.g., ±25% random variation on the delay) if operating in a multi-agent environment.
- **Ambiguous 500s from broken deployments**: A 500 from a permanently broken service will keep returning 500 indefinitely. The "retry once for ambiguous" rule correctly limits this to one extra attempt before escalation.
- **Escalation fatigue**: If escalations are too frequent (e.g., every transient error is surfaced), operators stop reading them. Reserve escalation for cases where the agent genuinely cannot proceed. Transient errors resolved within backoff should be logged, not escalated.
- **Alternative approach loops**: When trying alternative approaches for permanent errors, cap the alternatives (e.g., max 2 alternatives before escalating). An uncapped alternative-search can itself become a soft infinite loop.
- **String-matching brittleness**: The diagnostic signals above use HTTP codes and error substrings. Many tool wrappers normalize or wrap errors, dropping the original codes or messages. Where possible, prefer structured error metadata (status codes, error type fields) over substring matching. If the tool wrapper does not expose stable structured errors, treat classification as best-effort and bias toward "retry once" for genuinely ambiguous cases rather than immediate abort.

## Related Patterns

- **[Circuit Breaker for Recurring Agent Tasks](/agent-prompt-patterns/patterns/circuit-breaker)** — complements tool error triage at a higher level: where triage handles individual call failures, the circuit breaker detects sustained quality degradation across full task runs; a recurring pattern of permanent-error escalations is a signal that the circuit breaker should trip
- **[Dead Sprint Recovery](/agent-prompt-patterns/patterns/dead-sprint-recovery)** — the recovery procedure for sprint agents that died mid-flight; tool error triage applied earlier in the sprint (retrying transient failures with backoff) can prevent the sprint deaths that dead-sprint recovery addresses
- **[Empirical Validation Loop](/agent-prompt-patterns/patterns/empirical-validation-loop)** — the classification thresholds and backoff schedule in this pattern are empirically derived from documented incidents; the empirical validation loop is the mechanism for updating them as new failure modes are observed
