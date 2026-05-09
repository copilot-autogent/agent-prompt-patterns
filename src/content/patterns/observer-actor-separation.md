---
title: "Observer-Actor Separation"
category: "task-design"
evidenceLevel: "strong"
summary: "Split observe, decide, and act into separate agent tasks. A single agent doing all three produces shallow observation, premature decisions, and tunnel-visioned action."
relatedPatterns: ["dispatcher-pattern", "feedback-loop-via-memory", "position-over-wording"]
tags: ["task-design", "multi-agent", "standup", "separation-of-concerns", "scheduling"]
---

## Problem

You have a recurring scheduled task — a daily standup, a weekly health check, a sprint review. The task is supposed to: observe the current state of the system, decide what matters most, and then act on those decisions.

In practice, the agent does all three in sequence within a single session. The result:
- Observation is shallow (limited context, no cross-referencing)
- Decisions are anchored on whatever the agent happened to read first
- Actions are taken immediately, before the full picture is assembled
- Follow-through items get deferred to "next session" with no trigger

The root cause: a single agent doing sequential observe→decide→act has a diminishing context window and no separation between the mental modes of reading and doing.

## Context

This pattern applies when:

- A task involves reading many sources before deciding what to act on (reports, memory topics, logs, external data)
- Actions taken depend on synthesis across multiple information sources
- The task produces both a report _and_ spawns follow-on work
- Deferred items routinely go unaddressed ("I'll do this next session")

It's especially relevant for **recurring scheduled tasks** that run autonomously. Single-agent tasks frequently complete the observation phase but then don't follow through on decisions because the context window is consumed by observation.

## Solution

**Split the task into separate agents with distinct roles:**

```
Observer Agent        →  Dispatcher Agent        →  Actor Agent(s)
(read-only)              (decide, spawn)              (do the work)
observe + summarize      read observer output         implement specific item
write findings to         spawn actor per item         report completion
  memory                  to appropriate channel
```

**Practical implementation:**

1. **Observer**: Scheduled session-mode task that reads all sources, synthesizes findings, and writes a structured report to memory. No actions, no spawning. Pure read + write.

2. **Dispatcher**: Triggered after Observer (or runs in the same session, after a clear "now deciding" phase). Reads the observer output. For each actionable item: creates a `once` scheduled task or spawns an actor agent. Self-decidable items go directly; user-input items get surfaced explicitly.

3. **Actor agents**: Independent ephemeral sessions per work item. They receive focused context from the dispatcher. No synthesis needed — just execute.

**Key rules:**
- Observers must not take actions. If they do, observation stops early.
- Dispatchers must not do the work themselves. If they do, parallelism is lost.
- Actor agents must not re-observe. Trust the dispatcher's context.

## Evidence

Applied to a "daily standup" scheduled task that had chronic issues with deferred items and shallow reporting.

**Before (single agent)**:
- 5 of 7 runs were silent with no actionable output
- Items marked "will handle next session" reliably went unaddressed
- Observation was shallow — agent read 2–3 memory topics and stopped

**After (observer → dispatcher → once-task actors)**:
- Observer reads 8+ memory topics, cross-references logs, produces structured report
- Dispatcher creates `once` tasks for each actionable item, staggered 5 minutes apart
- Items get addressed in their own sessions without competing for context
- Zero "next session" deferrals — either done or scheduled

The pattern also resolved a secondary problem: standup prompts kept growing as more responsibilities were added. With separation, each role stays focused and prompts stay compact.

## Tradeoffs

**Benefit**: Each agent role is optimally shaped for its cognitive task. Observers can read deeply. Actors can act with full context on a single item.

**Cost**: More scheduled tasks to manage. Stagger timing to avoid concurrent session cap issues (5-minute gaps between actor spawns).

**Watch out for**:
- Observer writing too much to memory → subsequent agents can't fit it in context. Keep observer output structured and bounded.
- Dispatcher over-spawning → 10+ actor agents running simultaneously. Batch small related items into a single actor.
- Actor agents re-doing observation because the dispatcher's context was too thin → give each actor a tight, specific brief.

**Task explosion management**: For >5 actionable items, prefer a single "batch actor" with a prioritized list over N separate agents.

## Related Patterns

- **[Dispatcher Pattern](/agent-prompt-patterns/patterns/dispatcher-pattern)** — the dispatcher role is a specialized application of the pure dispatcher pattern
- **[Feedback Loop via Memory](/agent-prompt-patterns/patterns/feedback-loop-via-memory)** — observer writes to memory; actors read from it — the feedback loop connects the two
- **[Position Over Wording](/agent-prompt-patterns/patterns/position-over-wording)** — observer prompts must front-load the "read-only, no actions" constraint or actors sneak into the observer phase
