---
title: "Mid-Task Scope Pivot"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "When an executing agent discovers that the remaining work significantly exceeds the available budget, it should STOP, document the scope finding as a concrete deliverable, and signal for re-scoping — rather than proceeding until timeout with nothing to show."
relatedPatterns: ["execution-budget-aware-dispatch", "convergence-stall-detection", "max-retry-pivot", "long-horizon-task-phasing", "dead-sprint-recovery", "incremental-result-checkpointing"]
tags: ["agent-autonomy", "scope", "budget", "timeout", "pivot", "sprint", "planning", "recovery", "escalation"]
---

## Problem

Agents are dispatched with a budget estimate — explicit (e.g., "implement this in a 4h sprint") or implicit (context window limits). The estimate is sometimes wrong. When the agent discovers during execution that the task is 3–10× larger than estimated, it faces two paths:

1. **Proceed** — continue attempting the full task, burn remaining budget on partial implementation, timeout or context-overflow with incomplete deliverables. Cost: full budget wasted, zero net output, full re-run required.
2. **Stop and report** — halt at the recognition point, document the scope finding (what was discovered, what a realistic budget would look like, what a minimal scoped-down version would cost), exit gracefully. Cost: budget spent on discovery only; concrete deliverable (scope report) enables productive re-dispatch.

Without an explicit pattern, agents default to (1) — they continue because they're optimizing for task completion, not budget efficiency.

**Three failure signatures:**

**Silent timeout**: The agent discovers early that the task is far larger than estimated but continues working, hoping to "get most of it done." At the budget limit, it times out with a partially-implemented feature that cannot be merged. The supervisor receives no useful output and must re-dispatch the full task.

**Orientation burn**: The agent spends the majority of its budget on discovery — reading source structure, exploring dependencies, running orientation probes — and runs out of time before beginning implementation. No branch is created, no artifacts exist, and the re-dispatch faces identical orientation costs with no accumulated context.

**Silent pivot without documentation**: The agent recognizes the task is too large and quietly narrows its scope mid-task — implementing a simplified version without documenting the change. The delivered work doesn't match the original intent, and the scope reduction is invisible to the dispatcher.

## Context

This pattern applies when:

- An agent is dispatched with a budget (time limit, context window, token cap)
- The task scope was estimated before full analysis of the implementation
- The agent's first natural decision point (after initial orientation) reveals that the scope is significantly larger than the budget
- The agent has the ability to post to a shared surface (GitHub issue, PR description, channel message) before exiting

It does NOT apply when:
- The task is on track (scope ≈ budget): continue normally
- The task is slightly over budget (1.5×–2× estimate): compress scope or implement the core path and document what was deferred
- The budget itself is flexible: the agent should request a budget extension rather than pivot

The pattern is most valuable during the gap between task dispatch and first implementation commit — the period when scope surprises are discovered but before significant implementation work has started.

## Solution

**At the first natural decision point after scope becomes clear, evaluate scope against budget. If scope >> budget, stop and produce a scope-finding deliverable.**

### Step 1: The scope-budget check

At each **natural decision point** — after initial orientation, after a spike or exploratory implementation, or at any milestone where the scope picture changes significantly — evaluate:

```
if (estimated_remaining_work / remaining_budget) > PIVOT_THRESHOLD:
    trigger scope-pivot protocol
```

**Important**: Express both sides in the same unit. Use a proxy that is consistently measurable, such as **estimated work remaining (in time or steps)** compared to **budget remaining (same unit)**. Avoid mixing absolute time with token counts or context-window percentages — these are different bottlenecks, and comparing them directly leads to threshold miscalibration. If multiple limits may bind (time AND context window), evaluate the formula separately against each and pivot if ANY limit is exceeded by 3×.

**PIVOT_THRESHOLD = 3×** is a practical starting point. If the work looks like it will take 3× the remaining budget, pivoting is almost certainly better than proceeding.

Signals that scope >> budget:
- Orientation took >25% of total budget and full scope is not yet clear
- Implementation has multiple large sub-components not visible in the original task description
- Dependencies (libraries, APIs, data sources) needed are not yet set up
- The task requires architectural decisions that weren't anticipated
- A spike or first integration attempt revealed unexpected complexity mid-implementation

The check is not a one-time gate before implementation: re-evaluate at each significant decision point throughout the task. A scope surprise discovered after the first commit is still actionable if enough budget remains to produce a useful scope report.

### Step 2: The scope-finding deliverable

When triggering the pivot, produce a concrete document before exiting:

```markdown
## Scope Finding (mid-task pivot at [timestamp])

**Budget consumed:** ~[X]% on orientation/analysis
**Budget remaining:** ~[Y]%
**Estimated work remaining:** ~[Z]× the remaining budget

### What was discovered
[Concrete list: sub-components, dependencies, unknowns, decisions needed]

### Minimal viable scope (MVP)
[The smallest version of this task completable in the current budget]

### Full-scope estimate
[What a realistic budget for the full task would look like]

### Recommended next step
[Re-dispatch with MVP scope, or schedule a dedicated sprint for full scope]
```

Publish this to:
- Choose **one canonical surface** per task: the GitHub issue comment if one exists, otherwise the PR description if a branch is open, otherwise a channel/shared message. Avoid posting to multiple surfaces simultaneously — duplicate scope reports with no sync rule will diverge as the re-scoping conversation evolves, leaving dispatchers with contradictory guidance. On public repos or shared channels, the scope report describes system internals; review the content for architectural or operational details before posting.


### Step 3: Push and exit gracefully

After publishing the scope finding:

- Push any work-in-progress to a branch as evidence of what was explored. Before pushing, review the WIP for anything that shouldn't be public (credentials, internal hostnames, API keys read into files). Scope orientation typically touches only source files, but be explicit: push code and analysis notes, not environment snapshots or temporary files that may contain sensitive context.
- Use a clearly named branch (e.g., `scope-finding/<issue-number>`) rather than a feature branch, to signal intent. Note: branch naming alone does not prevent CI or deploy automation — check your repo's branch protection and workflow trigger rules before pushing WIP to any branch.
- If push access is denied or WIP branches are not permitted in the repo, preserve the orientation findings by including them in the scope-finding comment on the canonical surface instead. The goal is not losing the discovery context; a detailed comment achieves this when a branch is not feasible.
- Close the task gracefully — do NOT continue implementing past the pivot decision
- Apply a label like `scope:larger-than-estimated` if available
- Signal to the supervisor or dispatcher that re-scoping is needed before re-dispatch

### What NOT to do

- ❌ Continue implementing after recognizing the task is too large, hoping to "get most of it done"
- ❌ Silently timeout without documenting what was discovered
- ❌ Re-scope mid-task without documenting the original scope and the reason for the change
- ❌ Pivot to a smaller scope without flagging the change to the dispatcher

## Evidence

**realestate-radar #172**: A sprint was dispatched to implement a feature with an implicit 4-hour budget. The agent burned the full budget on orientation — reading source files, deciding structure — and timed out having never created a branch. Zero deliverables. Re-dispatch WITH an orientation hint in the issue body completed in 34 minutes (2058 seconds). The first 4 hours produced nothing because the agent had no protocol for recognizing "I've used 30% of my budget and haven't started implementing — this is too large, I should stop and report."

**CONTEXT.md Sprint Mid-Flight Death Recovery**: The recovery classification ("complete-but-unmerged vs incomplete WIP") implies the most common failure mode is *incomplete WIP*: the agent ran until timeout before the scope became deliverable. A stop-and-report protocol would convert many incomplete-WIP deaths into scope-finding deliverables, dramatically reducing re-sprint costs.

**Multiple cli-wrapper-monitor sprints**: Several sprints spent >2 hours exploring the codebase and running orientations before making any implementation decisions, timing out without code changes. In each case, the orientation findings were sufficient to inform a targeted re-dispatch — but were never documented, forcing the replacement sprint to repeat the same orientation.

These cases share a common pattern: the agent recognized (implicitly) that the task was too large but had no explicit protocol to act on that recognition. The result was a silent timeout rather than a useful scope report.

## Tradeoffs

**Benefit**: A scope-finding deliverable is always more useful than a silent timeout. The discoverer's orientation context (what sub-components exist, what dependencies are needed, where the complexity lives) is exactly the information a re-dispatch needs to succeed. Preserving it costs nothing extra if the agent exits gracefully instead of burning the remaining budget.

**Cost**: The pivot requires the agent to override its task-completion drive. An agent optimizing for "complete the task" will resist stopping even when stopping is the correct action. The pattern needs to be explicitly represented in the agent's operational guidelines, not just implied.

**Watch out for:**

- **Premature pivots**: If the threshold is set too low (e.g., 1.5×), agents pivot before they should, producing scope reports instead of working implementations for tasks that were achievable with normal execution. Calibrate the threshold against actual task failure rates.
- **Scope reports without actionable content**: A scope report that says "this is hard" without listing specific sub-components, decisions, or a concrete MVP path is not useful. The template format enforces actionable structure.
- **Pivoting without pushing work-in-progress**: If the agent exits without pushing any branch, the orientation work (file reads, structural analysis) is lost entirely. Even a branch with a single README update documenting the scope finding preserves the exploration context.

## Related Patterns

- **[Execution Budget-Aware Dispatch](/agent-prompt-patterns/patterns/execution-budget-aware-dispatch)** — the dispatcher-side complement: estimate scope and add orientation hints BEFORE dispatching. Mid-Task Scope Pivot is the agent-side complement: detect and pivot DURING execution when the estimate was wrong.
- **[Convergence Stall Detection](/agent-prompt-patterns/patterns/convergence-stall-detection)** — detects an agent making no progress on a *defined* task; this pattern detects that the *task definition itself* is too large for the budget.
- **[Max-Retry Pivot](/agent-prompt-patterns/patterns/max-retry-pivot)** — pivots when a single operation fails repeatedly; this pattern pivots when the *entire task scope* exceeds budget.
- **[Long-Horizon Task Phasing](/agent-prompt-patterns/patterns/long-horizon-task-phasing)** — plans phases before starting; this pattern handles scope surprises discovered *during* execution.
- **[Dead Sprint Recovery](/agent-prompt-patterns/patterns/dead-sprint-recovery)** — recovery after timeout (improved by having a scope-pivot deliverable to work from).
- **[Incremental Result Checkpointing](/agent-prompt-patterns/patterns/incremental-result-checkpointing)** — publishes work-in-progress before pivoting; pairs with this pattern so the pivot deliverable is backed by committed artifacts.
