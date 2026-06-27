---
title: "Staggered Task Spawning"
category: "multi-agent"
evidenceLevel: "strong"
summary: "When dispatching multiple concurrent agent tasks, stagger their start times by 3–5 minutes. Simultaneous spawning saturates session concurrency limits, produces silent failures with no retry, and leaves partially-complete work with no recovery path."
relatedPatterns: ["dispatcher-pattern", "context-window-budgeting", "pre-commit-planning-phase", "workspace-per-sprint-isolation"]
tags: ["multi-agent", "scheduling", "concurrency", "session-limits", "spawning", "reliability", "dispatch"]
---

## Problem

You have a recurring orchestrator — a standup, a morning briefing, a cross-project dispatcher — that identifies multiple actionable items and spawns them all at once. The dispatch loop fires. Six concurrent agents start. The system hits its session concurrency cap. Two agents fail silently: no error, no retry, no notification. The partially-complete dispatch produces an inconsistent state that's harder to reason about than "nothing ran."

Three failure signatures:

**Silent cap failure**: Agent spawn rejected because all slots are occupied. The agent framework creates a thread or entry, then quietly fails to execute. The orchestrator has no way to distinguish "running" from "failed to start."

**Contention during investigation**: Agents that start simultaneously all load shared memory, call the same APIs, and write to overlapping context. Concurrent reads are safe; concurrent writes to the same manifest topic produce last-write-wins corruption.

**False "all dispatched" signal**: The orchestrator reports success after firing the spawn loop. The orchestrator session ends. Half the agents never ran. No retry mechanism exists because the orchestrating session is gone.

## Context

This pattern applies to any orchestration layer that issues multiple spawns in a tight loop:

- Morning briefing or standup tasks that dispatch work items found during review
- Cross-project dispatchers that route findings to multiple project agents simultaneously
- Sprint decomposition agents that break a large task into N parallel sub-tasks

It's especially critical when the underlying agent runtime enforces a **hard concurrency cap per account** (e.g., 3–5 concurrent sessions). This cap is often undocumented and only discovered empirically when simultaneous spawns stop completing.

The failure mode is invisible at the prompt level — no error is raised, no warning is logged. The orchestrating session ends cleanly; the missing agents are only discovered when checking output hours later.

## Solution

**Spread spawns over time using staggered `once` scheduled tasks instead of a simultaneous spawn loop.**

Instead of:
```
spawn(agent-A)  # fires immediately
spawn(agent-B)  # fires immediately — cap hit
spawn(agent-C)  # fires immediately — cap hit, silent fail
```

Use:
```
schedule(agent-A, now + 0min)
schedule(agent-B, now + 5min)
schedule(agent-C, now + 10min)
```

**Practical rules:**

**1. Default stagger: 5 minutes between spawns.** This gives each agent enough time to acquire a session slot, bootstrap, and begin working before the next agent competes for capacity. For lightweight agents (< 60s runtime), 2–3 minutes is sufficient.

**2. Prioritize by impact, not by discovery order.** When staggering, schedule the highest-value agent first. If the orchestrator is interrupted after firing 3 of 6 spawns, the top-3 items completed rather than a random 3.

**3. Use `once` scheduled tasks, not inline spawns, for multi-agent dispatch.** Inline spawns live and die with the orchestrating session. Scheduled tasks survive session end and can be inspected, cancelled, or rescheduled independently. This also decouples dispatch latency from orchestrator runtime.

**4. Batch related items into a single agent when context is shared.** Don't spawn N agents for N items if they share investigation context (same codebase, same manifest). Spawn one agent with a list. Staggering is for genuinely independent work streams.

**5. Cap total concurrent spawns at N-1 slots.** If the platform limit is 5, never schedule more than 4 agents to overlap. Leave one slot for interactive sessions (the user's own channel).

## Evidence

An autonomous agent system running 6 recurring sprint agents across 6 project channels encountered this failure during a weekly standup session:

**Before staggering**: The standup orchestrator identified 6 actionable items and dispatched all 6 agents within a 10-second window. The platform's concurrent session limit (4 slots) was immediately saturated. 2 of 6 agents never started; their Discord threads were created but no session was attached. The orchestrator reported "6 dispatched" and terminated. The missing agents were discovered ~2 hours later during a manual check. No automatic retry existed.

**After staggering (5min intervals)**: The same 6 items were scheduled as `once` tasks at T+0, T+5, T+10, T+15, T+20, T+25 minutes. All 6 completed successfully within 30 minutes. The total wall-clock time increased by ~25 minutes, but the completion rate went from 66% to 100%.

**Write-contention observation**: On a separate incident, 3 agents spawned simultaneously all attempted to `save_memory` to the same `work-pipeline` topic within their first 60 seconds. Two writes succeeded; one produced a partial overwrite that merged content from two different agents into a single incoherent topic. The memory guard (read-before-write) caught the third write but the partial state required manual repair. Post-incident rule: agents writing to shared memory must be staggered by at least the expected write latency.

**Cap discovery method**: The concurrency limit was discovered empirically — there is no API to query available slots. Agents that fail to acquire a slot exhibit identical observable behavior to agents that start normally: the spawn API returns success, the thread/entry appears, and the session simply never progresses. Budget conservatively (N-1 slots) and treat silent non-completion as the signal.

## Tradeoffs

**Benefit**: Near-100% spawn completion rate. Shared memory integrity maintained. Each agent gets a clean session slot with no contention.

**Cost**: Total wall-clock time for a batch of N agents increases by (N-1) × stagger_interval. For 6 agents at 5min stagger, that's 25 extra minutes. This is acceptable for non-urgent background work but may be too slow for time-sensitive pipelines.

**Watch out for**:
- **Stagger drift**: Scheduled tasks fire at their scheduled time regardless of whether earlier agents are still running. If agents take longer than expected, you may still hit the cap. Use a longer stagger interval (10min) when agents are expected to run for 5–8 minutes.
- **Over-batching avoidance**: Don't stagger 20 agents at 5min intervals to produce a 100-minute pipeline when batching into 4 agents of 5 items each would produce the same result in 20 minutes. Staggering and batching are complementary.
- **Orchestrator coupling**: If the orchestrator must confirm all agents completed before proceeding (e.g., a sync aggregation step), staggered spawning requires a different pattern — either a polling step or a completion-signal mechanism. Staggering works best for fire-and-forget batch dispatch.

## Related Patterns

- **[Dispatcher Pattern](/agent-prompt-patterns/patterns/dispatcher-pattern)** — the orchestration pattern that produces the spawning problem; staggering is the scheduling constraint that makes dispatchers reliable at scale
- **[Context Window Budgeting](/agent-prompt-patterns/patterns/context-window-budgeting)** — staggered spawns give each agent a clean start; budgeting ensures agents complete their work before the next wave starts
- **[Pre-Commit Planning Phase](/agent-prompt-patterns/patterns/pre-commit-planning-phase)** — agents that plan upfront can estimate their runtime, allowing the orchestrator to set stagger intervals proportionally to agent complexity
