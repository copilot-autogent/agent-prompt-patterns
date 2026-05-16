---
title: "Pre-Commit Planning Phase"
category: "task-design"
evidenceLevel: "strong"
summary: "Force autonomous agents to enumerate their complete planned actions—with estimated step counts—before touching any code or state. Agents that plan first discover budget and feasibility constraints early, reorder to front-load critical work, and avoid the silent partial-completion failure that afflicts time-bounded sprint agents."
relatedPatterns: ["bounded-autonomy", "context-window-budgeting", "dispatcher-pattern"]
tags: ["planning", "execution", "time-budget", "sprint", "partial-completion", "idempotency", "pre-execution"]
---

## Problem

You run a time-bounded autonomous agent—a sprint task, a scheduled job, a CI step. The agent starts working, makes real progress, hits the time or token limit at step N, and stops. Steps N+1 through end are silently dropped. The partially-complete result is harder to reason about than either "done" or "not started."

Worse: the agent often does the *easiest* steps first, because they come first in the task description. Critical steps (create PR, push build artifact, update manifest) land at the end—the part that gets cut.

Three failure signatures:

**Silent truncation**: The agent ran out of budget mid-task. The caller has no way to know what was dropped without auditing every output.

**Wrong ordering**: The agent processed 10 of 12 backlog items in the order they appeared. Items 11 and 12—which happened to be the highest-value ones—were never reached.

**Infeasibility surprise**: 30 minutes in, the agent discovers the task requires a tool that doesn't exist, an auth token that isn't set, or a dependency that takes 15 minutes to install. Budget wasted on a blocking constraint that was knowable upfront.

All three share a root cause: the agent committed to execution before establishing a plan.

## Context

This pattern applies to any agent that:

- Runs with a hard time or token budget (scheduled tasks, CI jobs, sprint agents)
- Executes a multi-step task where individual steps have variable cost
- Produces outputs that are only useful when complete (a PR, a deployed artifact, a published post)
- May encounter infeasible preconditions mid-execution

It is most valuable for **multi-phase tasks** where later phases (review, publish, notify) are small but load-bearing, and for **tasks that repeat on a schedule**, where a clean "not started" is far better than a silent partial.

## Solution

**Add a mandatory planning phase at the start of the agent prompt—before any action-taking phase.** The planning phase has three steps:

### Step 1: Enumerate the full plan

Before making any changes, the agent produces a numbered list of ALL planned actions, in execution order. Each item is one sentence. The list must include every step including the "boring" ones at the end.

```
PLANNING PHASE — complete before making any changes:

1. List all planned actions as a numbered checklist, in execution order.
2. Include every step: discovery, implementation, test, push, PR creation, manifest update, notifications.
3. Estimate the cost of each step: [quick] = <1 min, [medium] = 1-5 min, [heavy] = 5+ min.
4. Sum total estimated time. If it exceeds 80% of your time budget, reorder or reduce scope NOW—not after starting.
5. Identify any blocking preconditions (auth tokens, tool availability, external dependencies). Verify them before proceeding.

Only after completing the planning checklist, begin execution.
```

### Step 2: Front-load the irreversible steps

The planning phase makes ordering explicit. The prompt should instruct the agent to reorder its plan so that **the most critical irreversible artifacts come first**:

```
Ordering rule: if a step produces a durable artifact (commit, PR, deployed file), 
it should come BEFORE any step that merely improves or polishes that artifact.
Create the PR as soon as build + tests pass. Run review and apply fixes AFTER.
A PR with minor issues exists; a dropped final step doesn't.
```

### Step 3: Acknowledge known infeasibilities immediately

```
If any planned step has an unresolvable blocker, state it at the end of the planning 
phase and adjust the plan. Do not discover blockers mid-execution.
```

**Minimal prompt addition (for existing sprint agents):**

```
BEFORE MAKING ANY CHANGES:
Write a numbered plan covering every step you intend to take, 
with [quick/medium/heavy] estimates. 
If total estimated time > [X] minutes, trim scope now.
```

## Evidence

**Production sprint data (8+ weeks, 6 sprint agents):**

Three consecutive sprint agents (Sprint 1–3 in a single project) created their PRs within the final 5% of their time budget: at 1540s, 1797s, and 1797s of an 1800s ceiling respectively. Sprint 3 created its PR 3 seconds before timeout. One more tool call and the entire sprint's work would have been lost.

Root cause in each case: the agent processed backlog items in order without estimating total cost upfront. High-value items were ordered last (by convention, not priority). The agent discovered the constraint at step N rather than step 1.

**After adding "PR first, review second" ordering rule to PLAYBOOK** (a partial implementation of this pattern):
- No sprint has lost a PR to timeout since
- Review findings became additional commits on existing PRs rather than dropped work

This is the ordering sub-rule. The full pattern—explicit step enumeration before execution—was not yet implemented in sprint prompts, representing an open opportunity.

**Research validation (MCP-Cosmos, arXiv:2605.09131):**

MCP-Cosmos demonstrated that infusing generative world models into MCP agent pipelines—allowing agents to simulate state transitions *before* execution—measurably improved both tool success rate and tool parameter accuracy across 20+ benchmark tasks. The key mechanism: agents that model execution paths before committing to them discover dead ends in latent space rather than in production.

The Pre-Commit Planning Phase is a **lightweight BYOWM-lite** (Bring Your Own World Model) implementation: instead of a learned latent model, the agent uses its own language capability to simulate the execution plan. No additional infrastructure required. The benefit is smaller than a full learned world model but available in any prompt-based agent today.

**Anti-patterns that motivated this pattern:**

- Agents that announce they will "handle the remaining items next time" — there is no next time for time-bounded agents unless scheduled, and scheduling is not guaranteed
- Agents that write "TODO: run tests" in a comment and ship — the planning step should make clear that "run tests" is an explicit step in the plan with a budget estimate
- Agents that discover 8 minutes in that a required API endpoint requires an auth token they don't have — a 30-second precondition check in the planning phase would have caught this

## Tradeoffs

**Benefit**: Eliminates silent partial-completion failures. Reduces wasted budget on infeasible paths. Improves ordering so critical artifacts (PRs, published files) survive timeout. Gives callers a way to audit what was dropped (the plan).

**Cost**: Planning phase consumes some budget—typically 5-15% of total. For very short tasks, this overhead is disproportionate. Apply selectively to multi-step tasks with hard time budgets.

**Watch out for:**

- **Plan drift**: The agent plans step A, executes A, then decides to do B instead of step 2. Add an explicit instruction: "if you deviate from the plan, note why and update the remaining steps."
- **Over-planning**: Some agents produce 20-step plans for 3-step tasks. Add a scope constraint: "the plan should have at most N steps; batch related work."
- **Planning as procrastination**: An agent that plans perfectly but never executes has failed the task. The planning phase should have a hard stop: "planning ends after the numbered list. If you write more than 200 words in planning, you are over-planning."
- **Precondition checks that take longer than execution**: Verifying all preconditions for a 2-minute task shouldn't take 10 minutes. Scope precondition checks to high-risk assumptions only.

## Related Patterns

- **[Context Window Budgeting](/agent-prompt-patterns/patterns/context-window-budgeting)** — budgeting manages token cost; planning phase manages *time* cost and *task ordering*. Use together: context budgeting ensures the planning output itself doesn't consume too much context.
- **[Bounded Autonomy](/agent-prompt-patterns/patterns/bounded-autonomy)** — bounded autonomy decides whether to act at all; planning phase decides *how* to act. The planning phase naturally produces escalation triggers: if step N is "change user-facing behavior," bounded autonomy rules apply.
- **[Dispatcher Pattern](/agent-prompt-patterns/patterns/dispatcher-pattern)** — the dispatcher routes tasks to agents; planning phase is what the agent does on receipt. Dispatcher and planning phase are complementary: dispatcher answers "who," planning phase answers "how, in what order, and is it feasible."
