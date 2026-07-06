---
title: "Graceful Capability Degradation"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "When a primary tool, service, or model is unavailable, identify a lower-capability alternative and continue operating in reduced mode — rather than failing completely. Preserve partial task value, communicate transparently about reduced capability, and restore full capability when the primary recovers."
relatedPatterns: ["circuit-breaker", "tool-error-triage", "rate-limit-back-off", "subprocess-env-scope-verification", "uncertainty-gated-irreversible-action"]
tags: ["autonomy", "resilience", "fallback", "degradation", "availability", "error-recovery", "capability-tiers"]
---

## Problem

Agent tasks depend on tools, APIs, models, and services that can fail, rate-limit, lose authentication, or degrade in latency. Agents without a degradation strategy either fail the entire task or silently retry indefinitely. Neither outcome serves the user.

Two brittle failure modes emerge:

**Complete halt**: The agent calls a primary tool, receives an error, logs it, and stops — even when an alternative path exists that would deliver most of the task's value. A `workflow_dispatch` that returns 403 halts a deployment that could have succeeded via a commit nudge. A timed-out deploy API causes the agent to report "deploy failed" when the site was already serving the last-good build and would self-recover.

**Silent infinite retry**: The agent retries the primary path indefinitely without a circuit breaker or fallback. The task appears stuck. No partial value is delivered. No signal reaches the user.

The root cause: agents are designed for the happy path. Capability dependencies are implicit — the agent assumes tools will work, and has no defined behavior when they don't.

## Context

This pattern applies when:

- The agent depends on tools, services, or APIs that have known failure modes (auth errors, rate limits, timeouts, unavailability)
- At least one meaningful fallback capability exists — a slower path, a cached result, a secondary auth mechanism, or a reduced-feature mode
- Delivering partial value on the current task is better than halting completely
- The user is capable of assessing risk and accepting reduced-capability output when clearly communicated

It does **not** apply when:

- No fallback exists and the task genuinely cannot proceed without the primary capability
- The fallback produces output that could mislead the user into treating it as full-capability (e.g., a stale cache presented without a staleness warning)
- The task involves irreversible actions — in degraded mode, pair with `uncertainty-gated-irreversible-action` before proceeding

## Solution

**Classify capabilities by tier, detect failure at the edge, degrade transparently, and restore when the primary recovers.**

### 1. Classify capabilities by degradation tier

Before beginning any task with external dependencies, mentally map each dependency to its degradation tiers:

| Tier | Condition | Response |
|------|-----------|----------|
| **Full** | Primary tool/service available | Normal operation |
| **Reduced** | Secondary path available (slower, fewer features, lower quality) | Degrade gracefully, notify user |
| **Minimal** | Only cached or static data available | Serve what exists, flag staleness explicitly |
| **None** | Task cannot proceed without primary capability | Surface the blocker, save state, wait |

For example, triggering a CI/CD deploy has three tiers:
- **Full**: direct dispatch API succeeds → use it
- **Reduced**: direct dispatch is unavailable (e.g., 403 due to token scope) → use an alternative trigger (e.g., a commit nudge on the push-trigger branch), and communicate the tradeoff
- **None**: no write access at all → surface the blocker, wait for manual trigger

### 2. Detect failure at the edge, not the center

Check capability availability at the point of first use — before committing to a path that requires the capability to be present. Do not attempt the primary operation optimistically if you have reason to believe it will fail.

When detecting environment-scoped limitations (e.g., subprocess token lacking required permissions), verify first:

```
Before issuing API calls that require elevated auth:
- Check whether the required credential/token is available in the current execution env
- If absent: go directly to the fallback (e.g., MCP tools, alternate auth path)
- Do NOT attempt the call and let it fail — a known limitation should route to fallback at the edge
```

This pairs directly with the `subprocess-env-scope-verification` pattern: verify scope before use, not after failure.

> **Two entry points**: For *unknown* failures, attempt the primary and let circuit-breaker determine whether to retry or open. For *known* env-scoped limitations (e.g., a token definitely absent from the subprocess env), skip the primary attempt and route directly to the fallback tier — no wasted auth error needed to discover an already-known constraint.

### 3. Fall back transparently, not silently

When degrading, **explicitly communicate the degradation** to the user. Silent fallbacks hide reliability problems and prevent users from assessing output quality.

Template:
> "Primary [capability] is unavailable ([reason]). Falling back to [alternative] — [tradeoff]. Same goal, [difference]."

Real examples from production:
- *"Primary deploy API is unavailable (dispatch not authorized). Falling back to commit-nudge method to trigger deploy — same outcome, slightly slower."*
- *"Primary auth path is absent from subprocess env. Falling back to MCP tool auth for this API call — identical result, different auth path."*
- *"Deploy backend is timing out (provider-side degradation). Last-good build is live and serving users. Waiting for backend recovery rather than retrying aggressively."*

### 4. Scope the degradation narrowly

Only the failed capability degrades — continue all other parts of the task at full capability. Avoid "all-or-nothing" failure modes where one unavailable tool halts an otherwise-healthy multi-step task.

If a deploy API is unavailable but code review, PR creation, and test execution all work normally, those steps should proceed on the primary path. Only the deploy step uses the fallback.

### 5. Restore and notify when the primary recovers

When the primary capability becomes available again, switch back from the fallback and communicate the restoration. Do not remain in degraded mode indefinitely after recovery.

> "Deploy API now available (recovered from GitHub-side outage). Subsequent deploys will use the primary `workflow_dispatch` path."

If the agent cannot detect recovery automatically (e.g., no polling mechanism), document the degraded state in a handoff note so the next session or the user can trigger restoration.

### 6. Compose with circuit-breaker for fast-fail detection

The circuit-breaker pattern answers: *when should I stop retrying the primary?*

Graceful capability degradation answers: *what should I do next?*

They compose naturally:

```
For unknown failures:
1. Attempt primary capability
2. On failure → circuit-breaker: is this transient or permanent?
   - Transient: retry with backoff (see rate-limit-back-off)
   - Permanent (circuit open): identify fallback tier, activate degraded mode

For known env-scoped limitations (detected at edge before attempting):
1. Verify capability availability at edge
2. If unavailable: go directly to fallback tier (no wasted primary attempt)

In degraded mode:
3. Notify user explicitly about degraded state and tradeoff
4. Continue task at reduced tier

On recovery:
5. Restore primary capability, notify user
```

### Do not attempt irreversible actions without confirmation in degraded mode

Degraded mode changes the risk profile of actions. A task that was safe to execute autonomously at full capability may require explicit user confirmation when operating from a fallback:

- Stale cached data → confirm before using as input to a write operation
- Reduced-scope auth → confirm before actions that appear to succeed but may have unexpected side effects
- Slower secondary path → confirm before long-running operations where the user may have assumed instant execution
- Additive fallbacks (e.g., triggering a workflow via a commit nudge) are generally lower-risk than destructive writes, but must still be communicated explicitly so the user understands the tradeoff (an extra commit in history, a slightly different trigger mechanism)

Pair with `uncertainty-gated-irreversible-action` for any action in degraded mode that cannot be reversed, particularly deletions, overwrites, or writes from stale/cached data.

## Evidence

Three independent production incidents document this pattern in operation across distinct failure modes:

**1. GitHub Pages deploy backend outages** (multiple repos, 2026-06-30 to 2026-07-06)

Factor-dashboard, shogi-srs, and realestate-radar all encountered GitHub Pages `actions/deploy-pages` timeouts and `"Deployment failed, try again later"` failures during backend degradation events. The correct degraded-mode behavior — observed and codified — is:

- The live site continues serving the last-good build (Pages CDN stays up; only new deploys stall)
- The agent does not declare "deploy failed" or close the issue
- Recovery is triggered via a nudge commit (the `on: push` fallback) rather than continuous `workflow_dispatch` retries
- Full capability (direct dispatch) is restored once the backend recovers

This is graceful capability degradation operating at the infrastructure level: the site itself degrades from "latest build" to "last-good build" without going dark.

**2. Dual-token auth path fallback** (agent runtime, 2026-07-02)

An agent with two GitHub auth paths — one scoped narrowly (subprocess env) and one broader (MCP server auth) — needed to issue API calls in a subprocess context where the elevated token was not propagated.

The documented correct behavior: when the subprocess env lacks the required elevated token, fall back to MCP tools (which use the server's own auth) rather than failing and reporting "missing token." This is graceful degradation in practice: detect primary auth path is unavailable in the current execution context, switch to the secondary auth path, continue the task.

**3. Direct dispatch 403 → commit-nudge fallback** (multiple repos, recurring)

A CI/CD dispatch API call returned 403 — "Resource not accessible by personal access token" — because the token lacked dispatch permissions. The documented fallback: push a no-op nudge commit to the default branch, triggering the workflow via its push trigger instead. Same outcome (workflow runs), different mechanism (commit-triggered vs. API-dispatched), with the tradeoff (one extra commit in history) made explicit to the user.

**Evidence level: strong** — three independent incidents across different failure modes (infrastructure outage, env scoping, auth scope limitation), each documented with observable production outcomes. The pattern was not designed speculatively; it was extracted from repeated successful incident recovery.

## Tradeoffs

**Benefits:**
- Preserves partial task value when primary capabilities are unavailable
- Maintains user trust through transparent communication
- Reduces operational brittleness in production environments where dependencies fail
- Creates a natural checkpoint for user communication rather than silent failure

**Costs:**
- Requires pre-identifying fallback tiers before tasks begin (upfront design work)
- Adds complexity to task prompts that must enumerate degradation paths
- Transparent communication about fallbacks may surface reliability issues users were unaware of

**Watch out for:**

- **Silent degradation**: the most common anti-pattern — the agent uses the fallback without telling the user. This hides reliability signals and prevents users from assessing output quality. Every degradation must be communicated.

- **Fallback treated as equivalent**: if the fallback is materially worse than the primary (slower, lower quality, potentially stale), this must be disclosed. Don't present reduced-capability output as full-capability output.

- **Irreversible actions in degraded mode**: operating on stale data or with reduced auth scope can have unexpected side effects. Pair with `uncertainty-gated-irreversible-action` for write operations in degraded mode.

- **Permanent degradation**: the agent may forget to restore the primary path after recovery, remaining in a slower fallback mode indefinitely. Always include a restore-and-notify step.

- **Over-degradation**: don't apply degradation logic to tasks where no fallback exists. Identifying a "minimal" tier that doesn't actually deliver useful value creates false confidence.

## Related Patterns

- **[Circuit Breaker for Recurring Agent Tasks](/agent-prompt-patterns/patterns/circuit-breaker)** — answers *when* to stop retrying the primary capability; graceful capability degradation answers *what to do next* — they compose in sequence: circuit opens → activate degraded mode
- **[Tool Error Triage](/agent-prompt-patterns/patterns/tool-error-triage)** — diagnoses tool errors to correctly classify which degradation tier applies; without triage, agents may activate the wrong fallback or skip degradation entirely
- **[Rate Limit Back-off](/agent-prompt-patterns/patterns/rate-limit-back-off)** — a specific instance of graceful degradation for rate-limited APIs: the degraded mode is a slower retry schedule or a cached result, and the primary is restored once the rate window expires
- **[Subprocess Env Scope Verification](/agent-prompt-patterns/patterns/subprocess-env-scope-verification)** — implements "detect failure at the edge": verify that the subprocess environment has the required tokens and permissions before issuing calls that depend on them, enabling clean degradation to alternative auth paths
- **[Uncertainty-Gated Irreversible Action](/agent-prompt-patterns/patterns/uncertainty-gated-irreversible-action)** — gates irreversible actions on explicit confirmation; in degraded mode, the uncertainty threshold for what counts as "irreversible" is lower, making this pattern a necessary complement for write operations
