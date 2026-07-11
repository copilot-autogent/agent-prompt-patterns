---
title: "Proactive Constraint Recall"
category: "memory-management"
evidenceLevel: "strong"
summary: "In long-horizon tasks, agents systematically forget specific requirements stated early in the trajectory while still pursuing the high-level goal. Before each significant action, proactively surface constraints whose domain overlaps the action category — and assert the planned action satisfies them before proceeding."
relatedPatterns: ["periodic-goal-alignment-checkpoint", "verification-before-completion", "pre-commit-planning-phase", "max-retry-pivot", "memory-read-before-write", "belief-entropy-checkpointing", "strategic-recall-before-ideation"]
tags: ["constraints", "requirements", "long-horizon", "memory", "constraint-decay", "retry", "phased-tasks", "proactive-recall"]
---

## Problem

In long-horizon agent tasks (20+ action steps), agents systematically forget **specific requirements and constraints** stated early in the trajectory — while still pursuing the high-level goal. The goal is remembered; the guardrails are not.

The failure mode: step 2 specifies "must use bcrypt for password hashing." Step 47, while fixing an unrelated bug, the agent switches to MD5 because it's simpler. Nothing flagged the violation. The high-level goal (implement auth) is still being pursued; the specific constraint is silently discarded.

This is structurally different from goal drift (addressed by `periodic-goal-alignment-checkpoint`). **Goal drift** is forgetting the destination. **Constraint decay** is forgetting the guardrails while still heading for the destination.

Three documented failure sub-modes:

**Requirement amnesia**: A constraint from the task brief is violated mid-task when the agent is absorbed in a different sub-problem. The agent is not "confused" — it's locally rational but globally wrong.

**Retry without prior failure consultation**: An agent retries a failing operation without querying what previous attempts tried and why they failed, repeating the exact same error. The failure history is in context but never surfaced.

**Cross-phase constraint leakage**: In a phased task, a constraint established in Phase 1 is not surfaced at the start of Phase 2. The new phase begins without awareness of earlier architectural decisions.

## Context

Applies to any agent executing tasks with 20+ action steps where requirements were specified upfront or accumulated during the task — especially:

- Sprint agents executing a multi-file implementation
- Research agents with scoped collection criteria
- Code-generation agents with stated architectural constraints
- Any agent where the initial brief is long enough that later context has displaced it

The pattern is specifically about the window between `pre-commit-planning-phase` (requirements set upfront) and `verification-before-completion` (final check) — the long middle stretch where constraints can silently erode.

**Not addressed by existing patterns:**
- `periodic-goal-alignment-checkpoint` — periodic, high-level goal check; not constraint-specific or action-triggered
- `verification-before-completion` — end-of-task; catches violations after they've propagated
- `belief-entropy-checkpointing` — uncertainty tracking; not requirements surfacing
- `strategic-recall-before-ideation` — recall before new ideation; not before each action step

## Solution

Before each **significant action step** (write, merge, API call, delete, schema change), proactively match "what I'm about to do" against "what constraints exist here":

**Step 1 — Identify action category**
Label the current action: `data-write`, `dependency-add`, `auth-related`, `file-delete`, `schema-change`, etc.

**Step 2 — Recall constraints relevant to that category**
Query the task's initial requirements and earlier in the trajectory for any constraint whose domain overlaps the action category. Examples:
- About to touch auth code → surface auth requirements from the task brief
- About to delete a file → surface any "preserve X" or "don't modify Y" constraints
- About to retry a command → query prior failure log for what was tried and why it failed

**Step 3 — Assert before acting**
For each surfaced constraint: confirm the planned action satisfies it. If a conflict is found, resolve it before proceeding — don't document it and proceed anyway.

**Trigger**: relevance to the current action (not a fixed interval). This distinguishes it from `periodic-goal-alignment-checkpoint`.

### Core prompt instruction

```
Before each significant action, internally verify (or explicitly state):
1. What I'm about to do (action + scope)
2. What constraints from earlier in this task apply here
3. Whether the planned action satisfies all of them

If any constraint is violated by the plan, resolve it first.
```

> In user-facing or policy-constrained systems, the check may be an internal reasoning step rather than visible output — what matters is that the verification occurs before the action proceeds.

### Prior-failure query (retry variant)

```
Before retrying [operation]:
- What did previous attempts try?
- What did each fail with?
- How does this attempt differ from the failed ones?

If it's identical AND the prior failure was deterministic (logic error,
wrong parameter, bad state) — don't retry, pivot the approach.
If the prior failure was transient (rate limit, network timeout,
eventually-consistent backend) — an identical retry with backoff/jitter
is appropriate; note the transient nature explicitly.
```

### Worked examples

**Requirement amnesia — averted:**

```
# Without the pattern
Step 2: "Use bcrypt for password hashing" [stated in brief]
Step 47: agent fixes unrelated bug, switches hash to MD5 for simplicity.
→ Constraint violated; shipped to production.

# With the pattern
Step 47: About to modify auth module.
  Action category: auth-related
  Constraints recalled: "must use bcrypt for password hashing" (task brief, step 2)
  Assertion: planned MD5 change violates this constraint.
  Resolution: keep bcrypt. Bug fix scoped to exclude hashing logic.
→ Violation caught at decision time, before it ships.
```

**Cross-phase constraint leakage — averted:**

```
# Without the pattern
Phase 1 establishes: "All API responses must be paginated."
Phase 2 sprint begins, new endpoints added without pagination.
→ Constraint silently dropped at phase boundary.

# With the pattern
Phase 2 start: About to add new API endpoints.
  Action category: schema-change, data-write
  Constraints recalled: "All API responses must be paginated" (Phase 1 decision)
  Assertion: new endpoints must implement pagination before shipping.
→ Constraint carried forward; no leakage across phases.
```

**Retry without failure consultation — averted:**

```
# Without the pattern
Step 30: Command fails. Step 35: exact same command retried. Fails again.
Step 40: exact same command retried. Fails again. Identical error each time.

# With the pattern
Step 35: About to retry [command].
  Prior failures recalled: step 30 — same command, same error (timeout on /api/v2/data).
  How does this attempt differ? It doesn't — same parameters.
  Resolution: pivot approach — use cached data or call /api/v1/data instead.
→ Identical retry blocked; new path explored immediately.
```

## Evidence

**arXiv 2607.08716 — "Remember When It Matters: Proactive Memory Agent" (July 2026)**
Formal study of requirement decay in long-horizon agentic trajectories. Key findings: (1) sprint agents routinely forget requirements from early in long trajectories — the forgetting correlates with trajectory length; (2) agents retry failed commands without consulting prior failure logs, repeating errors already encountered; (3) open subgoals and constraint violations scatter across 100+ step trajectories without resurfacing. The proposed Proactive Memory Agent (PMA) approach — proactively querying memory before relevant decision points — improved task completion rates measurably. The study frames this as a "believing when it matters" problem: the information exists in context; the agent fails to surface it at the relevant moment.

**Autogent sprint pipeline (CONTEXT.md, multiple incidents)**
CONTEXT.md documents: *"Common: sprint identifies requirement early, violates it 20+ steps later while fixing unrelated bug."* The failure is consistent enough to appear in the standing push-file alongside security and deploy rules. Multiple sprint agents in the autogent pipeline violated early-stated constraints during bug-fix sub-tasks — the constraint was never re-surfaced when the agent's scope shifted.

**Evidence level: strong** — independently documented in formal research (quantitative) and production sprint failures (empirical). The structural cause is the same in both: constraints exist in context; no mechanism surfaces them at the point of decision.

## Tradeoffs

**Benefit**: Specific constraints don't silently erode over long trajectories. Violations are caught at decision time — before they propagate into shipped code, merged PRs, or downstream agents that inherit the bad state.

**Cost**: Every significant action step has an added introspection overhead. For short tasks (< 20 steps), the overhead is rarely worth it; the task brief is still in active context. Apply selectively to long-horizon tasks.

**Watch out for**:

- **Constraint over-surfacing**: querying ALL prior constraints before every micro-action creates noise. Target significant actions (schema changes, file writes, API calls) not every reasoning step.
- **Stale constraints**: a constraint from early in the task may have been explicitly superseded later. When resolving conflicts between earlier and later constraints on the same topic, prefer the later one — *except* when the earlier constraint comes from a higher-authority source (system-level requirement, security policy, compliance rule). Recency overrides by default; authority overrides by exception.
- **Constraint conflicts**: surfacing two conflicting constraints from different points in the trajectory requires a resolution step, not silent selection of one. Raise the conflict before acting.

## Related Patterns

- **[Periodic Goal Alignment Checkpoint](/agent-prompt-patterns/patterns/periodic-goal-alignment-checkpoint)** — periodic high-level goal check; this pattern fills the intra-period, constraint-specific, action-triggered gap
- **[Verification Before Completion](/agent-prompt-patterns/patterns/verification-before-completion)** — end-of-task verification; this pattern is the mid-task equivalent for specific constraints
- **[Pre-Commit Planning Phase](/agent-prompt-patterns/patterns/pre-commit-planning-phase)** — establishes the requirements this pattern resurfaces; together they close the loop
- **[Max Retry Pivot](/agent-prompt-patterns/patterns/max-retry-pivot)** — what to do after retries exhaust; this pattern is upstream: check failure history *before* retrying to avoid retrying identically
- **[Memory Read Before Write](/agent-prompt-patterns/patterns/memory-read-before-write)** — recall before modifying memory; same recall-first discipline applied to task constraints
- **[Belief-Entropy Checkpointing](/agent-prompt-patterns/patterns/belief-entropy-checkpointing)** — complementary: checkpoints encode decision rationale at branch points; proactive constraint recall surfaces those constraints before each subsequent action
- **[Strategic Recall Before Ideation](/agent-prompt-patterns/patterns/strategic-recall-before-ideation)** — recall before generating new plans; proactive constraint recall applies the same discipline before each action step within an execution
