---
title: "Idempotent Cron Session Isolation"
category: "multi-agent"
evidenceLevel: "moderate"
summary: "Scheduled agents configured with persistent:true reuse a single SDK session across ticks. For idempotent meta-crons — agents whose job is stateless per-tick (review open PRs, file ideation issues, run audits) — this session reuse introduces harmful in-context memory: the agent remembers doing work in a prior tick and silently skips it in the current one. The fix is to set persistent:false on any cron whose per-tick work should be a fresh, independent evaluation."
relatedPatterns: ["circuit-breaker", "duplicate-agent-spawn-prevention", "async-first-decision-tree"]
tags: ["cron", "scheduling", "persistent-session", "session-isolation", "idempotency", "silent-failure", "meta-cron", "multi-agent"]
---

## Problem

Scheduled agents (crons) running on repeating intervals are often configured with `persistent: true`, which reuses a single SDK session across all ticks. For agents with evolving long-term state — sprint supervisors, project monitors — this is correct behavior. They benefit from remembering prior context.

But **idempotent meta-crons** — agents whose job is stateless per-tick — accumulate harmful in-context memory. This produces three failure modes:

**Silent work skip**: The agent remembers reviewing a PR in a prior tick, decides "already done," and skips it — even though the PR has new commits and needs a fresh review.

**Completion time collapse**: Normal ticks take 300–800 seconds. After session reuse, the agent completes in 27–65 seconds because it bypasses all work based on prior-tick context. The fast completion looks healthy but represents zero work done.

**No observable error**: The agent finishes successfully; logs show no failure. The bug is detectable only by comparing expected output (e.g., PR review comments posted) against actual output — a comparison that requires intent-aware monitoring most systems don't have.

**Root cause**: `persistent: true` session reuse causes the model's in-context memory of prior reviews to bleed into the current tick's decision-making. The agent cannot distinguish "I did this earlier this session" from "I did this in a prior independent tick."

## Context

This pattern applies whenever both conditions are true:

1. The agent runs on a repeating schedule (cron or interval)
2. Each tick is logically independent — the correct behavior on tick N does not depend on what happened on tick N-1

Common examples: open PR reviewer, issue ideation generator, stale branch auditor, dependency health monitor, failing test reporter.

The pattern does **not** apply to:
- Multi-session sprint agents that explicitly continue prior work ("resume the open PR from last session")
- Agents that explicitly maintain state across ticks (incrementally building a dataset, tracking SLA windows)
- One-shot `once` tasks (no repeat means no session reuse risk)

## Solution

**Set `persistent: false` on any idempotent meta-cron agent task.**

> **Note**: `persistent: false` eliminates cross-tick context bleed, but it does not make an agent's actions inherently idempotent. A fresh-session agent can still duplicate side effects (posting duplicate comments, filing duplicate issues) if it doesn't check external state before acting. True idempotency requires the agent's prompt to include explicit "check before act" instructions (e.g., "before posting a review, verify no existing review comment covers this point"). Session isolation prevents *memory contamination*; prompt-level guards prevent *duplicate side effects*. If tick overlap is possible (e.g., a slow cron tick that outlasts the schedule interval), locking or deduplication at the scheduling layer is also required.

```yaml
# BAD: idempotent cron with persistent session
task:
  name: pr-reviewer
  execution_mode: agent
  persistent: true    # ← keeps context across ticks; causes silent skip
  schedule: "0 */4 * * *"
  prompt: "Review all open PRs and post comments for issues found."

# GOOD: idempotent cron with isolated session
task:
  name: pr-reviewer
  execution_mode: agent
  persistent: false   # ← fresh context every tick; each evaluation is independent
  schedule: "0 */4 * * *"
  prompt: "Review all open PRs and post comments for issues found."
```

### Decision rule

| Agent type | `persistent` setting | Rationale |
|---|---|---|
| Meta-cron with idempotent per-tick work (review, ideation, monitoring, audit) | `false` | Fresh context prevents prior-tick bias |
| Sprint agent with multi-session state (implement feature, fix bug) | `true` | Context continuity aids recovery across ticks |
| One-shot `once` task | N/A | Single tick; setting has no effect |

### Diagnostic signal

If a repeating cron agent completes **faster than 20% of its normal baseline for comparable workload**, suspect a silent skip. This is a heuristic, not a hard rule: a healthy tick with fewer open items (fewer PRs, no new issues) will legitimately run faster. Calibrate against work volume, not raw time alone. Investigate:

1. **Expected output**: What should this tick have produced given the current workload? (comments filed, issues created, changes made)
2. **Actual output**: What did it actually produce?
3. **Completion time vs. historical baseline for similar workload**: A 30-second tick where the prior tick with identical inputs took 5 minutes is a near-certain skip.

The fast-completion pattern is the primary early-warning signal. Monitor it actively for any cron agent doing review or evaluation work, and supplement with output-count metrics where possible.

## Evidence

**Autogent operational incident**: The `pr-reviewer` and `pr-merger` tasks, both configured with `persistent: true`, showed 27–65 second completion times on subsequent ticks (vs. normal 300–800s). Investigation revealed the agent was using in-context memory of prior PR reviews to decide "already reviewed" on all open PRs without inspecting current state. Setting `persistent: false` restored normal behavior immediately.

**Session continuity mismatch**: SDK session reuse was designed for *stateful* workflows where context continuity has positive value. Applying it to stateless per-tick workflows is a category error — it introduces state where none should exist, turning an agent's memory from an asset into a liability.

**Silent failure profile**: Unlike crashes or timeouts, session-bias failures produce successful-looking completions. Logs show no exception, the agent exits cleanly, and scheduling infrastructure marks the tick as complete. The bug surfaces only when someone notices that PRs stopped getting reviewed — often days or weeks later. This makes session-bias failures among the hardest operational bugs to detect without intent-aware output monitoring.

## Tradeoffs

**Session startup overhead**: Each tick creates a new session (10–30s startup), adds token overhead for system prompt reinjection, and loses any caching the persistent session provided. For high-frequency crons (every minute), this overhead is measurable. For typical review/monitoring crons (every 1–4 hours), it is negligible relative to the cost of silent skips.

**Reduced resilience to prompt context**: A persistent session that has already loaded large tool outputs or built up intermediate state can be slightly more efficient at continuing long-form analysis. For genuinely stateless per-tick work, this advantage does not apply.

**When persistence genuinely helps idempotent agents**: Some agents labeled "idempotent" actually benefit from a small amount of cross-tick state — for example, an agent that should remember "I filed an issue for this problem last week, skip if it's still open." If the desired semantics are "skip if already acted," this logic belongs in the **prompt** (e.g., "before filing, check for an existing open issue"), not in session reuse. Encode the idempotency check explicitly rather than relying on in-context memory.
