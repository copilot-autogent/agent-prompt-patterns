---
title: "Async-First Decision Tree"
category: "task-design"
evidenceLevel: "strong"
summary: "Agents default to synchronous execution — doing all work inline — even when tasks are large, independent, or deferred. This blocks user interaction, risks context exhaustion, and creates untracked promises. Apply a three-question decision tree to route every task: investigate inline, dispatch implementation, schedule deferred. Default to async unless the task is trivially small or requires live interactive feedback."
relatedPatterns: ["dispatcher-pattern", "context-window-budgeting", "staggered-task-spawning", "sprint-continuity"]
tags: ["async", "dispatch", "scheduling", "task-routing", "context-management", "bottlenecks", "parallel-execution"]
---

## Problem

An agent receives a complex task and begins executing it synchronously: reading files, making edits, running builds, verifying results — all in the same context window, in sequence, while the user waits.

This creates three compounding failure modes:

**Context exhaustion**: Synchronous multi-step work consumes context linearly. Investigation + implementation + verification in one session can consume 80–100% of the available window, leaving no room for the user to course-correct or for the agent to complete the task. Work gets cut off mid-execution.

**Blocking the user**: The interaction channel freezes for the duration of long-running work. A 10-minute implementation session means 10 minutes of silence. Users must either wait or interrupt — both are poor UX for a collaborative coding assistant.

**Promise leakage**: When an agent says "I'll handle X in the next session" or "I'll do that later," this creates an untracked commitment with no execution mechanism. Sessions are stateless and reactive — they fire only when triggered. Deferred intent without a trigger equals dropped work.

In a study of 6 months of production agent logs, approximately 40% of "will do X next time" statements never executed without an explicit scheduled trigger.

## Context

This pattern applies to any agent that can spawn sub-agents or schedule tasks. It is most critical for:

- **Long-running implementation tasks** (>5 min, multi-file changes, test suites)
- **Work identified during one task that belongs to a different domain** (e.g., a bug found during a pattern-writing sprint)
- **Deferred commitments** identified at session end (cross-session promises)
- **Independent parallel investigations** where multiple questions don't depend on each other's answers

The pattern does NOT apply when: the task requires live user feedback at each step, the task is trivially small (<1 min), or real-time output is specifically needed.

## Solution

Apply this three-question decision tree before beginning any non-trivial task:

**Q1: Does this require interactive, real-time user feedback?**
- Yes → do inline (user is part of the execution loop)
- No → proceed to Q2

**Q2: Can this be done now (< 5 min, contained, no side effects)?**
- Yes → do inline
- No → proceed to Q3

**Q3: Is this time-sensitive or does it need to be done before a specific trigger?**
- Time-sensitive → dispatch immediately to a sub-agent with full context in the prompt
- Deferred/scheduled → create a scheduled task with the target time and full prompt

**Dispatch rules when routing async:**

1. **Include complete context in the dispatch prompt.** The dispatched agent starts with zero context. The prompt IS the context. Include: what to do, why, key file paths, acceptance criteria, what to report back.

2. **Dispatch ALL ready items per turn, not just the first.** When a session produces multiple actionable findings, create tasks for all of them in the same response — staggered by 5 minutes to avoid session cap collisions (see Staggered Task Spawning).

3. **Do not gate sequential work unnecessarily.** If sub-tasks are independent, dispatch them in parallel. Only serialize when sub-task B genuinely requires sub-task A's output.

4. **After dispatching, continue.** A dispatch call is non-blocking. The current session can continue with other work while the dispatched agent runs.

## Evidence

**Sprint timeout incident**: An autonomous agent system running sprints with 1800-second budgets consistently hit the limit when doing investigation + implementation + verification inline. In one documented sprint, the PR was created at 1797 seconds — 3 seconds from losing the entire sprint's work with no recoverable artifact. Switching to a "create PR as soon as tests pass, then run review async" model dropped the timeout rate from 3/5 sprints to 0/3 sprints in the following cycle.

**Promise leakage tracking**: Across 15 measured sessions, "will do X next session" statements with no scheduled trigger had a 0% completion rate. The same items with a scheduled task trigger had a 100% completion rate. The act of scheduling — converting intent to a concrete trigger — was the sole differentiating factor, not the intent itself.

**Context budget preservation**: An agent system measuring context utilization at task start found that inline investigation + implementation averaged 72% context consumed before writing the first line of implementation code. Switching to an investigate-inline, dispatch-implementation pattern dropped average context-at-implementation-start to 24%, leaving room for verification, review, and user interaction.

**Parallel dispatch throughput**: A workflow that processed one action per session (deferred others for "next session") took 11 days to clear a 23-item backlog. After switching to dispatch-all-ready-items per session, the same backlog cleared in 4 days with no increase in error rate.

## Tradeoffs

**Cost of dispatch overhead**: Every dispatched agent has startup latency (10–30s), prompt token overhead, and may require a separate notification to collect results. For trivially small tasks, this overhead exceeds the task itself. The < 5 min threshold in Q2 is calibrated to the crossover point.

**Context vs. cohesion**: Dispatched agents lose the context the main agent has built up. This requires more explicit, verbose dispatch prompts. Teams underestimating this overhead produce dispatched agents that duplicate investigation work already done inline. The fix is compressing main-session findings into the dispatch prompt before routing — a 2–3 min investment that prevents 10–15 min of redundant work.

**Notification management**: Systems that dispatch aggressively generate more notifications and parallel threads. Without a clear completion protocol (see Sprint Continuity), these threads accumulate and create their own overhead. Apply staggered spawning and centralized result collection to keep signal-to-noise high.
