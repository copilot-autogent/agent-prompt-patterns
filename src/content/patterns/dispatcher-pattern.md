---
title: "Dispatcher Pattern"
category: "multi-agent"
evidenceLevel: "strong"
summary: "Use a pure dispatcher agent that only reads context and spawns actor agents — never does the work itself. Dispatchers that do work lose parallelism, accumulate context debt, and serially block on tasks that could run concurrently."
relatedPatterns: ["observer-actor-separation", "proactivity-injection"]
tags: ["multi-agent", "dispatcher", "parallelism", "spawning", "task-design", "ephemeral-agents"]
---

## Problem

You have a scheduling task — a standup, a batch processor, a sprint planner. It reads some inputs and then needs to do several things: fix a bug here, write content there, run a health check elsewhere. You write one agent to do all of it sequentially.

The agent starts executing the first item. By the time it's done, the context window has shrunk. The second item gets less attention. The third gets rushed. The fourth gets deferred with "I'll handle this next session."

You try adding parallelism by spawning sub-agents from within the task. But now the agent is doing the work AND managing the spawns. It dispatches one task, then waits to see how it goes before dispatching the next. The benefits of parallelism disappear.

The root cause: a dispatcher that does work optimizes for task completion, not task delegation. These are different cognitive modes. Mixing them in one agent produces a worse version of both.

## Context

This pattern applies when:

- A scheduling or orchestration task produces multiple independent work items
- Work items can run concurrently (don't depend on each other's outputs)
- Different items require different contexts, tools, or target channels
- The scheduling task's context window would be consumed if it did the work itself

It pairs naturally with **Observer-Actor Separation** — the observer produces findings, the dispatcher reads those findings and routes work, and actors execute without re-observing.

## Solution

**Implement a pure dispatcher: it reads, it decides, it routes. It never executes.**

```
Dispatcher Agent responsibilities:
 Read observer output / scheduled findings
 Classify each item: self-decidable vs. user-input-needed
 Spawn actor agents for self-decidable items
 Surface user-input items explicitly (not defer them)
 Stagger spawns to avoid concurrent session caps
 Never do the work itself
 Never wait for actor results before dispatching the next item
 Never defer items to "next session"
```

**Spawn discipline — the stagger rule:**

```
Item 1: spawn actor → target channel A, fires at T+0
Item 2: spawn actor → target channel B, fires at T+5min  
Item 3: spawn actor → target channel C, fires at T+10min
```

Five-minute stagger between spawns prevents concurrent session cap exhaustion. For >5 items, batch related items into a single actor with a prioritized list rather than spawning N separate agents.

**Routing decision tree:**

```
For each actionable item:
  Is it self-decidable (clear root cause, no design discussion needed)?
  → YES: spawn actor now, staggered
  → NO: surface explicitly to user with options and your recommendation
       NEVER defer to "next session" — if you don't decide now, it won't get decided
```

**The deferral test**: Before closing the dispatcher session, every item must be in one of three states: spawned, surfaced, or explicitly skipped with a logged reason. "Next session" is not a valid state.

## Evidence

A recurring orchestration task ("daily standup") was rewritten from single-agent to dispatcher pattern over several iterations:

**Single-agent (before):**
- 5 of 7 runs produced no output actionable agent ran out of context and deferred 
- Items marked "will handle next session" had a ~0% completion rate (sessions are reactive, not self-initiating)
- Average depth of observation: 2–3 memory topics before context pressure forced action

**Dispatcher pattern (after):**
- Observer reads 8+ memory topics without context pressure (observation is its only job)
- Dispatcher spawns 6 actor agents per run, staggered 5 minutes apart3
- Actor agents complete work in their own sessions with full context per item
- Zero "next session" deferrals across 20+ consecutive runs
- Items that need user input are explicitly surfaced, not dropped

The secondary finding: dispatcher prompts are dramatically simpler than single-agent prompts. When the dispatcher only routes, there's no need to embed deep knowledge about how to do the work. That knowledge lives in the actor prompts.

## Tradeoffs

**Benefit**: Linear scaling of parallel work. Each actor gets full context for its specific task. Dispatcher session stays small and fast.

**Cost**: More scheduled tasks to manage. Actor sessions have spin-up overhead.

**Watch out for**:
- Dispatcher creep: the dispatcher notices a "small" item and does it inline instead of spawning. This always grows. Enforce the rule strictly.
- Actor context starvation: the dispatcher's handoff brief is too thin and actors re-do observation. Each spawn brief must be self-contained — include files, goals, acceptance criteria.
- Spawn explosion: >10 actors from one dispatcher run causes concurrent session cap issues. Batch small related items.

**The pure dispatcher test**: After the dispatcher runs, check its action log. If it executed any code, wrote any files, or posted any content — it's not a pure dispatcher. Refactor.

## Related Patterns

- **[Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation)** — the dispatcher is the "decide" layer between observer and actors; this pattern defines the dispatcher's specific responsibilities and constraints
- **[Proactivity Injection](/agent-prompt-patterns/patterns/proactivity-injection)** — dispatchers can apply proactivity injection to surface proposals alongside spawning work items
