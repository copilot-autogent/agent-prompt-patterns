---
title: "Async-First Execution"
category: "task-design"
evidenceLevel: "strong"
summary: "Agents default to doing all work inline — synchronously, in the current session — even when tasks are large, deferred, or belong in a different channel. This blocks interaction, inflates context, and loses cross-channel work. A four-row dispatch matrix routes every task to the right execution mechanism: inline, sub-agent, once-task, or cross-channel once-task."
relatedPatterns: ["async-first-decision-tree", "staggered-task-spawning", "sprint-continuity", "dispatcher-pattern"]
tags: ["async", "dispatch", "scheduling", "task-routing", "channels", "context-management", "execution"]
---

## Problem

An agent identifies work to do. It begins doing it inline: reading files, making edits, spawning sub-processes, verifying results — all within the current interaction, in sequence, while the user waits.

Three failure modes emerge:

**Wrong channel**: Work spawned via a sub-agent or inline execution in channel `#dev` posts results back to `#dev`. But the work belongs to a side project living in `#project-alpha`. The user sees results in the wrong place and the project agent never knows the work happened.

**Session expiry**: Long-running work (builds, multi-file refactors, research sweeps) consumes context and hits session timeouts. In one documented case, a PR was created at second 1797 of a 1800-second budget. Three seconds later and the entire sprint's work would have been lost with no recoverable artifact.

**Promise leakage**: The agent says "I'll handle that in the next session." Sessions are stateless and reactive — they only fire when triggered. Without a scheduled task, the intent has no execution mechanism. "Next session" equals never.

## Context

This pattern is a concrete routing guide for agents with access to three execution primitives:
- **Inline execution** — work done in the current session
- **`task` sub-agent** — lightweight parallel investigation; returns result to current session
- **Scheduled `once` task** — fires at a specific time in its own fresh session; can target a specific output channel

Apply this pattern whenever you're about to begin non-trivial work inside a current session.

## Solution

**Before beginning any non-trivial task, apply this four-row dispatch matrix:**

| Situation | Execution | Why |
|-----------|-----------|-----|
| Need result immediately to continue conversation | Inline or `task` sub-agent | Must be in current context |
| Implementation work starting now | `task` sub-agent | Full tools, clean context; posts completion |
| Deferred work / fires at a specific time | `once` scheduled task | Concrete trigger; not dependent on user message |
| Cross-channel work | `once` task with target `output_channel_id` | Sub-agent threads land in current channel only |

**Key difference between sub-agent and `once` task:**
- Sub-agent: starts immediately, notifies current session on completion
- `once` task: starts at a specified time, independent session, routes to a target channel

**Dispatch prompt quality is load-bearing.** Each dispatched agent starts with zero context. The prompt IS the context. Include:
- What to do and why
- Key file paths or URLs
- Acceptance criteria
- What to report back / where to write results

Under-specified dispatch prompts produce agents that duplicate investigation already done inline — a 10–15 min waste.

**Dispatch all ready items per turn.** When a session produces multiple actionable findings, create tasks for all of them in the same response — staggered by 5 minutes to avoid concurrent session cap collisions.

**After dispatching, continue.** A dispatch call is non-blocking. The current session can proceed while the dispatched agent runs.

**Never gate PR creation on review.** Create the PR as soon as build+tests pass. Run multi-model review after the PR exists. Push review fixes as additional commits. This preserves the durable artifact even if the session times out during review.

## Evidence

**Session timeout prevention**: An autonomous agent system running sprints with 1800-second budgets consistently hit the limit when doing investigation + implementation + verification inline. After switching to "create PR as soon as tests pass, then run review async," timeout rate dropped from 3/5 sprints to 0/3 in the following cycle. The critical PR was created at second 1797 of 1800 — the pattern was introduced one sprint before catastrophic failure.

**Cross-channel routing failure**: A sprint agent working in `#dev` was dispatched via `spawn_task` to handle a side-project task targeting `#project-alpha`. Results posted to `#dev`, never visible in `#project-alpha`. The project agent in `#project-alpha` had no record of the work having happened. Fix: `once` scheduled task with explicit `output_channel_id` set to the project channel.

**Promise leakage tracking**: Across 15 measured sessions, "will do X next session" statements with no scheduled trigger had a **0% completion rate**. The same items with a scheduled `once` task trigger had a **100% completion rate**. The act of scheduling — converting intent into a concrete trigger — was the sole differentiating factor.

**Parallel dispatch throughput**: A workflow processing one action per session (deferring others for "next session") took 11 days to clear a 23-item backlog. After switching to dispatch-all-ready-items per session with staggered timing, the same backlog cleared in 4 days with no increase in error rate.

## Tradeoffs

**Cost of dispatch overhead**: Every dispatched agent has startup latency (10–30s), prompt token overhead, and may require a notification collection step. For trivially small tasks, this overhead exceeds the task. Keep inline work for tasks < 5 minutes with no side effects.

**Context vs. cohesion**: Dispatched agents lose the accumulated context of the main session. More explicit, verbose prompts are required. Under-investing in prompt quality produces agents that redo investigation already done inline.

**Task explosion management**: Dispatching all ready items per turn can generate 10+ simultaneous agents. For > 5 items, prefer a single "batch worker" `once` task with a prioritized list over N separate agents. Stagger spawn times by 5 minutes to avoid concurrent session cap limits.

**Notification overhead**: Aggressive dispatch generates more threads and notifications. Without a clear completion protocol, these accumulate and create their own noise. Apply staggered spawning and route results to appropriate channels to keep signal-to-noise high.

## Related Patterns

- **[Async-First Decision Tree](/agent-prompt-patterns/patterns/async-first-decision-tree)** — a complementary pattern covering the Q1/Q2/Q3 routing decision logic; this pattern focuses on the routing matrix and channel-targeting mechanics
- **[Staggered Task Spawning](/agent-prompt-patterns/patterns/staggered-task-spawning)** — how to space concurrent dispatches to avoid session cap collisions
- **[Sprint Continuity](/agent-prompt-patterns/patterns/sprint-continuity)** — how to preserve sprint work artifacts when sessions time out during long-running execution
- **[Dispatcher Pattern](/agent-prompt-patterns/patterns/dispatcher-pattern)** — the general pattern for routing decisions to actor agents
