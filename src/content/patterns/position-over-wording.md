---
title: "Position Over Wording"
category: "prompt-structure"
evidenceLevel: "strong"
summary: "Place mandatory instructions before content, not after. Model compliance drops to near-zero when critical directives follow the content they should govern."
relatedPatterns: ["observer-actor-separation", "feedback-loop-via-memory"]
tags: ["instruction-placement", "compliance", "spawn-task", "prompt-design"]
---

## Problem

You write a spawn-task prompt that says: read the thread, summarize results, post to Discord. You include the directive to read the thread _after_ the content (mission description, goals, context). The agent completes the task without ever reading the thread. You add **"IMPORTANT"**, **"MANDATORY"**, **"CRITICAL"** — nothing changes.

The problem isn't the wording. It's the position.

## Context

This pattern applies whenever you are:

- Writing prompts for autonomous agents that receive content (previous results, data, context) alongside instructions
- Spawning background agents with a mix of operational directives and contextual payload
- Crafting scheduled task prompts where the agent must take an action _after_ reading some input

The pattern is especially critical for **read-before-act** directives (e.g., "recall memory before writing memory", "read the thread before summarizing", "check the manifest before updating it").

## Solution

**Mandatory instructions go first. Content goes after.**

Structure your prompts as:

```
[MANDATORY ACTIONS — what the agent MUST do first]

[CONTENT — context, data, background, goals]

[OPTIONAL ACTIONS — backlog, aspirational steps]
```

The mandatory block should be the _first thing the model reads_. This primes the model to hold the requirement in its active attention before it encounters the content that might distract it.

**Example — Before:**
```
You are a sprint agent for [project]. Your goal is [goals].
Background: [long context about the project...]
Sprint backlog: [items...]

IMPORTANT: Before doing anything, call read_channel_history to get the latest thread results.
```

**Example — After:**
```
MANDATORY FIRST STEP: Call read_channel_history("thread-id") before doing anything else.
Only after you have read the thread results should you proceed.

---

You are a sprint agent for [project]. Your goal is [goals].
Background: [long context about the project...]
Sprint backlog: [items...]
```

## Evidence

Tested empirically with 3 parallel spawn_task agents running variants of a notification-reading prompt:

- **Variant A** (instruction at end, no emphasis): 0/3 agents called `read_channel_history`
- **Variant B** (instruction at end, with "IMPORTANT" / "MANDATORY" emphasis): 0/3 agents called `read_channel_history`
- **Variant C** (instruction at start, before all content): 3/3 agents called `read_channel_history`

**Result**: 100% compliance with position-first placement vs. 0% compliance with end-of-prompt placement regardless of emphasis language.

This finding was replicated across multiple runs and spawned a broader architectural principle: when agent behavior is non-compliant, check instruction position before changing wording.

## Tradeoffs

**Benefit**: Near-deterministic compliance for read-before-act directives.

**Cost**: Prompts feel less "natural" to write — humans typically front-load context, then instructions. You must invert this habit.

**Watch out for**: Very long mandatory blocks that bury key context. Keep the mandatory section tight (3–5 sentences max). If you need long instructions, use a numbered list at the top and expand below.

**Interaction effect**: This pattern amplifies `Feedback Loop via Memory` — if the "check feedback section" directive is buried at the bottom, agents skip it. Move it to the top mandatory block.

## Related Patterns

- **[Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation)** — separating observation from action eliminates the ordering problem entirely for multi-phase workflows
- **[Feedback Loop via Memory](/agent-prompt-patterns/patterns/feedback-loop-via-memory)** — the feedback-check directive must be at the top of the prompt for agents to reliably act on it
