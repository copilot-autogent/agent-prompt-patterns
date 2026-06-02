---
title: "Observe-Resolve Pairing"
category: "task-design"
evidenceLevel: "strong"
summary: "Every observation task needs a paired resolver counterpart. Observers that detect issues but take no action create backlog generators — findings accumulate without being addressed. Pair each observer with a resolver that runs shortly after, or route all findings to a pipeline with auto-decide dates."
relatedPatterns: ["observer-actor-separation", "dispatcher-pattern", "staggered-task-spawning"]
tags: ["task-design", "scheduling", "observe", "resolve", "pipeline", "automation", "recurring-tasks"]
---

## Problem

You build a scheduled standup agent that reads open PRs, checks failing tests, and reviews persistent state. It produces a nicely-formatted summary. The summary is accurate. Nothing happens.

Three weeks later, the same items appear in every standup summary. The observer found them on day one. But no resolver ever acted on them.

The root cause: **observation is only half the loop**. An agent that detects issues but never resolves them is a backlog generator. Each run adds to the pile without clearing it. Over time, the backlog becomes so large that no one trusts it, and the observation agent itself becomes noise.

A secondary failure: teams route findings to a human inbox ("standup posted to #dev"). The human is expected to be the resolver. When the human is busy, findings pile up. The explicit resolver contract disappears into "someone should handle this."

## Context

This pattern applies to any recurring observation agent:
- Daily standups / health checks
- Nightly CI failure reports
- Weekly security audit agents
- Persistent storage consistency checks
- Open PR triage

The pattern is most critical when:
- Findings are **self-decidable** — they have a clear correct action that doesn't require human judgment
- The observation agent runs autonomously on a schedule
- There's no dedicated on-call agent watching the output

It does NOT apply when: all findings require human judgment (legitimate escalation), or when the observation is purely informational and action is explicitly out of scope.

## Solution

**When adding any observation agent, immediately answer: what acts on what this finds?**

If the answer is "a human will read the summary," replace that with a resolver agent that runs shortly after.

**The pairing contract:**

```
Observer Agent            →   Resolver Agent
(reads, detects, reports)     (acts, fixes, clears)
runs at T+0                   runs at T+15min
writes findings to storage    reads findings, acts on self-decidable items
                              surfaces non-self-decidable items to user
```

**Three resolver patterns, in order of preference:**

1. **Immediate pairing**: Schedule a resolver agent 15–30 minutes after the observer. The resolver reads the observer's output from persistent storage and acts on self-decidable items directly.

2. **Pipeline routing**: If the observer produces heterogeneous findings (some self-decidable, some requiring human input), route everything to a work pipeline with auto-decide dates. A dispatcher agent handles self-decidable items; unresolved items surface to the user after their auto-decide date.

3. **Inline resolution**: For simple observations with a narrow, well-defined action space, merge observe + resolve into a single agent. Only use this when the action set is small and stable — growing action space is a signal to split.

**Morning cascade example** (15-min cadence, each completes before next starts):

| Time | Agent | Role |
|------|------|------|
| T+0 | standup | Observe: what's open? |
| T+15 | open-items-resolver | Resolve: merge/close/fix self-decidable |
| T+30 | open-threads-dispatcher | Dispatch: spawn work for pipeline items |
| T+45 | cross-pollination-triage | Route: new ideas into pipeline |

Avoid scheduling two agents at the same minute — they collide and one reads stale state from the other.

**Routing rule for findings:**

| Finding type | Resolution |
|-------------|------------|
| Self-decidable (clear correct action) | Resolver acts immediately |
| Low-stakes, bounded judgment | Resolver acts with a brief rationale logged |
| Requires user input | Added to pipeline with auto-decide date |
| Requires user input + time-sensitive | Surface immediately via message |

## Evidence

Applied to a "daily standup" agent that produced daily summaries but had chronic follow-through failure.

**Before (observer only)**:
- Standup ran 6 consecutive days reporting the same 3 open PRs
- Items were routed to a human inbox; human was occupied with other work
- 0 of the reported items were acted on within the observation window
- The standup summary was accurate but operationally useless

**After (observer + resolver pair)**:
- Standup observer runs at T+0, writes structured findings to persistent storage
- Resolver agent runs at T+15: merges Dependabot PRs, closes resolved issues, re-enables fixed background jobs
- After 5 runs: 23 self-decidable items resolved automatically, 4 escalated to user
- Follow-through rate for self-decidable items: 100% (up from 0%)

A second data point: security audit agents that previously generated reports with "recommended actions" showed 0% action rate over 60 days. After pairing with a resolver that acted on the subset of unambiguous items, the action rate on self-decidable security findings rose to 100%.

## Tradeoffs

**Benefit**: Closes the loop. Observations drive outcomes rather than generating noise.

**Cost**: More agents to manage. The resolver agent adds scheduling overhead and must be maintained alongside the observer. When the observer's output format changes, the resolver may break silently.

**Watch out for**:
- Resolver over-acting — taking actions beyond what's clearly self-decidable and requiring human escalation. Scope the resolver's action space explicitly in its instructions.
- Observer/resolver coupling — if the observer changes its output format, the resolver may fail silently. Use a stable, structured format (persistent storage with consistent keys) for the handoff.
- Resolver masking real problems — if the resolver auto-closes issues that should be escalated, problems accumulate silently. Add an escalation path for items that recur across N cycles without resolution.
- Missing the pipeline fallback — some observers find genuinely ambiguous items that don't belong in an auto-resolver. Always provide a pipeline route with auto-decide dates so these items don't silently disappear.

## Related Patterns

- **[Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation)** — the observer/resolver pair is a two-role specialization of the general observer-actor pattern
- **[Dispatcher Pattern](/agent-prompt-patterns/patterns/dispatcher-pattern)** — when a resolver needs to spawn multiple work items, it becomes a dispatcher
- **[Staggered Task Spawning](/agent-prompt-patterns/patterns/staggered-task-spawning)** — resolver tasks must be staggered from observer tasks to avoid reading stale state
