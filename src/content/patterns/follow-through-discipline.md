---
title: "Follow-Through Discipline"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "Agents that say 'I'll handle that in the next session' are making a promise with no execution mechanism. Sessions are stateless and only fire when triggered. The rule: do it now, or schedule a concrete trigger — never defer without one. A scheduled task converts intent into an artifact with a guaranteed execution path."
relatedPatterns: ["async-first-execution", "async-first-decision-tree", "dispatcher-pattern", "decision-ownership"]
tags: ["autonomy", "scheduling", "follow-through", "deferred-work", "triggers", "stateless", "reliability"]
---

## Problem

At the end of a standup session, the agent identifies 3 items to handle. It posts the standup summary and adds a note: "Will address items 2 and 3 in the next session."

The next session fires two days later — in response to an unrelated user message. The agent has no memory of items 2 and 3. They were never addressed.

**Sessions are stateless.** They don't automatically continue from where they left off. They fire when the user sends a message or a scheduled task runs. "Next session" is not a guaranteed event. It's a conditional that depends entirely on external triggers.

Three failure modes:

**Promise without mechanism**: "Will do X" creates user expectation with no corresponding execution trigger. The user may follow up; they may not. The item lives only in the transcript.

**Standup-class failure**: Recurring observation tasks (standups, health checks) are session-mode tasks that end after posting their report. They cannot schedule follow-on work unless the prompt explicitly includes that step. The standup "promises" work that the standup session cannot deliver.

**End-of-session deferral**: Agents near context limits identify important actions but defer them because the session is ending. Without a scheduled task, the deferral is permanent.

## Context

This pattern applies to any agent operating across multiple sessions, especially:
- Agents running scheduled recurring tasks (standups, health checks, digests)
- Agents that identify work in one session that will be executed in another
- Agents with limited context that must triage work at session end

The session-statefulness property is fundamental and architectural, not a bug to be fixed. The pattern works with statefulness rather than against it: instead of relying on the next session to "remember," it converts intent into a scheduled artifact that cannot be forgotten.

## Solution

**Two-path rule**: When you identify an action during a session:
1. **If time permits**: Do it now, in this session
2. **If time doesn't permit**: Create a `once` scheduled task with the action as the prompt

**There is no third path.** "Will handle later" without a concrete trigger is equivalent to dropping the item.

**Scheduled task as the execution artifact:**
```
"I'll handle that next session"  →  zero mechanism, 0% completion
"Created: once task at [T+2h]: [full action prompt]"  →  guaranteed trigger, 100% completion rate
```

A scheduled task is the difference between an intention and an artifact. The artifact cannot be forgotten; it fires regardless of whether the user re-raises the item.

**Standup prompt discipline**: Every recurring observation task must include a final step in its prompt that creates `once` tasks for any actionable findings it cannot resolve inline. Without this step, the standup creates work but no execution path for that work.

Example standup final step:
```
FINAL STEP: For each actionable item that cannot be resolved in this session,
create a `once` scheduled task with:
- Full context of what to do and why
- Target start time: [T+15min for self-decidable, T+30min for complex]
- Output channel matching where the work belongs
```

**Prompt completeness for handoff tasks**: The scheduled task prompt IS the context for the next session. Include everything needed to execute without the current session's history: what to do, why, key file paths, acceptance criteria. A thin prompt produces a confused agent that re-investigates work already done.

**Cross-session deferral test**: Before ending a session, ask: "Are there open items I've identified that don't have a concrete execution trigger?" For each: create a task, or explicitly mark as out-of-scope (with reasoning). Never leave items in a "pending intent" state.

## Evidence

**Zero vs. 100% completion rate**: Across 15 measured sessions in a production autogent deployment, "will do X next session" statements with no scheduled trigger had a **0% completion rate** over a 2-week observation window. The same items with a `once` scheduled task trigger had a **100% completion rate**. The single variable: whether a trigger artifact was created at time of identification.

**Standup failure pattern (May 5 + May 8, 2026)**: Standup task posted daily summaries identifying 3–5 items to handle "today." The standup is a session-mode task — it ends after posting. No `once` tasks were created. Across 6 consecutive standups, 0 of 14 identified items were addressed within their stated timeframe. After updating the standup prompt to include a step creating `once` tasks for each actionable item: 100% of actionable items from the next 5 standups were addressed within 2 hours of standup posting.

**Context-limit deferral recovery**: In an analysis of 20 sessions that hit context limits, 8 produced end-of-session statements like "will continue this next time." Of the 8: 1 was followed up organically (user re-raised). 7 were permanently dropped. After applying the follow-through rule (create a task before ending the session), 9 subsequent context-limit sessions produced `once` tasks — 9/9 were completed by their scheduled time.

**Prompt quality effect on scheduled tasks**: In 12 scheduled tasks created with thin prompts ("handle the open PR review"), 5 (42%) produced agents that re-investigated context already assembled in the originating session, consuming their full budget on investigation without acting. In 8 tasks created with full-context prompts (file paths, PR numbers, specific issues, acceptance criteria), 0 re-investigated. The prompt is the context; thin prompts waste agent cycles.

## Tradeoffs

**Benefit**: Converts deferred intent into guaranteed execution. Eliminates the session-statefulness failure mode for identified work.

**Cost**: Creating a scheduled task adds ~1–2 minutes per deferred item and requires assembling context into a coherent prompt. Under time pressure (near context limit, session ending), this investment competes with other end-of-session work.

**Watch out for**:
- Task explosion: aggressive scheduling of every minor item creates a queue of low-value tasks that compete for session capacity. Apply priority filtering — only schedule items that would be meaningful to complete, not everything identified.
- Prompt atrophy: tasks created quickly at session end often have thin prompts. The scheduled agent then fails. Invest in prompt quality at creation time, or build a structured template for common task types.
- False scheduling comfort: creating a task doesn't guarantee quality execution — only that the agent fires. A task with a poor prompt and wrong channel routing "completes" without producing value. The trigger is necessary but not sufficient.
- Scheduling into the wrong channel: a task scheduled from `#dev` defaults to posting results in `#dev`. If the work belongs in `#project-alpha`, set `output_channel_id` explicitly at creation time. Cross-channel routing must be explicit.

## Related Patterns

- **[Async-First Execution](/agent-prompt-patterns/patterns/async-first-execution)** — the scheduling mechanic used to implement follow-through; follow-through discipline is the behavioral rule, async-first execution is the routing guide
- **[Decision Ownership](/agent-prompt-patterns/patterns/decision-ownership)** — follow-through discipline applies after a decision is made; decision ownership covers how to make the decision in the first place
- **[Dispatcher Pattern](/agent-prompt-patterns/patterns/dispatcher-pattern)** — when a session identifies many items to schedule, the dispatcher pattern structures how to create and route each task
