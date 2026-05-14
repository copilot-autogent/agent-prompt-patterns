---
title: "Context Window Budgeting"
category: "task-design"
evidenceLevel: "strong"
summary: "Reserve context for action, not just observation. Long-running agentic sessions that spend their full context window on investigation produce deferred work or silent failures — the agent runs out of runway before it can act."
relatedPatterns: ["observer-actor-separation", "dispatcher-pattern", "position-over-wording"]
tags: ["context", "session", "investigation", "budgeting", "offloading", "timeouts", "planning"]
---

## Problem

A long-running agent session begins with investigation: loading memory, reading files, tracing code paths, reviewing prior work. This is necessary. But investigation is unbounded — there is always more context to read, more history to load, more related files to check.

By the time the agent reaches the implementation phase, 60–80% of the context window is consumed. The agent either:

1. **Truncates early context** — forgets the problem statement or earlier findings, causing inconsistent output
2. **Times out before acting** — session budget exhausted, work partially done with no durable artifact
3. **Defers to "next session"** — a promise with no execution mechanism unless explicitly scheduled

None of these outcomes are visible at investigation time. The agent *feels* like it's making progress. But context spent on reading is context unavailable for writing.

## Context

This pattern applies to any single-session agent that must both investigate and produce output:

- Sprint agents that load memory before writing deliverables
- Debugging agents that trace code before writing fixes
- Research agents that survey prior work before synthesizing conclusions
- Maintenance agents that audit state before making changes

It's especially critical for **timed sessions** (where a hard time or token budget exists) and for **agents that defer work by default** (where "next session" is not a reliable trigger — see Follow-Through Discipline).

Measurement baseline: in an empirically instrumented agent system, the overhead consumed before the first user message reached 12,956 tokens (6.5% of a 200k context window) from system prompt, memory bootstrapping, and tool registration alone — before any investigation begins.

## Solution

**Allocate your context window as a budget before the session starts. Spend each phase proportionally.**

```
Context Budget:
- Investigation phase: 25% max
- Core work (implementation / writing): 55%
- Verification and cleanup: 15%
- Offload buffer: 5% (for spawning deferred tasks)
```

**Practical rules:**

**1. Set an investigation ceiling.** Before reading any file or loading any memory, decide what you *minimally* need to act. Read that. Stop. Do not expand scope during investigation — every additional file consumed is runtime budget spent.

**2. Act at 25%.** If investigation isn't complete at 25% context, work with what you have. A complete artifact based on partial investigation is more valuable than a perfectly-informed plan that produces nothing.

**3. Offload at 80%.** When context reaches 80% of the estimated limit, stop in-session work. Write a `once` scheduled task with the remaining scope and full context in the prompt. A scheduled task fires; a deferred intention does not.

**4. Make durable artifacts early.** Create the PR / commit / file / memory entry as soon as the first unit of work is complete — not after all work is done. This ensures partial progress survives session limits. (See related: *create the PR immediately after tests pass, run review after the PR exists*.)

**5. Separate investigation from action.** For large codebases, run an `explore`-type subagent for investigation and return only a concise summary — not the raw findings — to the main session. This prevents investigation-context bleed into the action phase.

## Evidence

The following patterns were observed in an autonomous agent system running recurring sprint sessions over 6+ weeks:

**Session timeout near completion**: A sprint session timed out at its 1,800-second limit with the PR created at 1,797 seconds — 3 seconds from losing all work. Post-mortem showed: investigation consumed the first 900s of session budget; implementation ran the clock to near-zero before producing the durable artifact. The fix was explicit sequencing: *artifact creation first, review second*.

**Context loading compound effect**: Sessions loading 5+ memory topics (average topic size: 3–8KB) before acting consumed 20–35% of practical session budget before any tool calls relevant to the task were made. Agents with 8+ memory loads routinely reached the implementation phase with under 50% of their effective action budget remaining.

**"Will do next session" = dropped work**: Analysis of deferred items across 15 sprint sessions showed that promises without a scheduled trigger had a near-zero completion rate. The session-ending agent *believed* it was handing off work; the receiving session never picked it up. Items only survived when explicitly scheduled.

**Offload at 80% — validated**: Sessions that created `once` scheduled tasks when approaching context limits produced measurably better outcomes than sessions that pushed through: the scheduled continuation had full context in its prompt and completed the remaining work in a fresh session without context competition from prior investigation.

**Investigation-to-action ratio**: Before explicit budgeting, investigation phases consumed 40–65% of session context across a sample of 12 measured sessions. After applying the 25% ceiling rule, the ratio dropped to 15–25% — with no measurable reduction in output quality, and a significant increase in complete deliverables per session.

## Tradeoffs

**Benefit**: Agents produce durable artifacts instead of "almost done" sessions. Deferred work has a trigger. PR/commit/file exists even when session budget runs out.

**Cost**: Acting on incomplete investigation means some output may need revision. This is acceptable — revision from a working base is more efficient than restarting from nothing.

**Watch out for**:
- **The "just one more file" trap**: Investigation scope expands to fill available budget. Set the ceiling explicitly in the prompt, not as a guideline.
- **Offload quality**: Spawning a deferred task at 80% only works if the prompt contains full context. A vague handoff prompt produces a vague continuation. Budget 5% of session for writing a complete handoff.
- **Phase boundaries**: The 25/55/15/5 split is a starting heuristic, not a universal law. Debugging-heavy sessions may need 40% investigation; write-heavy sprints may need only 10%. Calibrate to task type.

**Interaction effect**: This pattern works best when combined with [Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation) — investigation and implementation run in separate contexts where possible — and [Dispatcher Pattern](/agent-prompt-patterns/patterns/dispatcher-pattern) — the main session delegates investigation to a subagent rather than consuming its own context window.

## Related Patterns

- **[Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation)** — the structural version of this pattern: prevent investigation from consuming the same context window as action
- **[Dispatcher Pattern](/agent-prompt-patterns/patterns/dispatcher-pattern)** — dispatch investigation to subagents; receive only summaries in the main session
- **[Position Over Wording](/agent-prompt-patterns/patterns/position-over-wording)** — the budget rule itself must be placed at the top of the prompt (before any context loading) to be followed; instructions buried after content are ignored
