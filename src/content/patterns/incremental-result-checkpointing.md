---
title: "Incremental Result Checkpointing"
category: "task-design"
evidenceLevel: "strong"
summary: "Long-horizon agent tasks run in a single continuous session. When the session dies — timeout, OOM, auth revocation, container restart — all intermediate work evaporates if it was never published to a durable surface. Publish concrete deliverables at each natural phase boundary before proceeding, so that recovery finds real artifacts rather than a blank slate."
relatedPatterns: ["belief-entropy-checkpointing", "atomic-incremental-commits", "dead-sprint-recovery", "execution-budget-aware-dispatch", "phase-gated-epic-body"]
tags: ["task-design", "checkpointing", "resilience", "recovery", "durability", "long-horizon", "sprint", "intermediate-results", "timeout", "agent-death"]
---

## Problem

Long-horizon agent tasks — implement a feature, write a multi-section document, run a multi-step analysis — are executed in a single continuous session. Sessions can die for many reasons: timeout, OOM, auth revocation, network partition, container restart. When death happens before the final deliverable is ready, all intermediate work evaporates — because it existed only in the agent's working context.

Three concrete failure signatures:

**Total loss on timeout**: A sprint agent burns its full 4-hour wall-clock budget on orientation and incremental implementation work, produces a nearly-complete result, but never commits or publishes anything before the session ends. Recovery agents arriving at the scene find a blank slate — no branch, no commit, no comment. The full sprint must be re-run from scratch.

**Undiscoverable partial progress**: A sprint completes its core library module and test suite, but defers the wiring step ("I'll wire it in once the tests pass"). The session dies before wiring. Recovery agents see no open PR and no branch. They re-implement the library module from scratch, unaware that the prior work was complete and correct.

**Ambiguous recovery classification**: A recovery agent finds an open PR with some but not all phases complete. Without phase-boundary checkpoints (e.g., a comment saying "design decision: chose approach A"), the recovery agent cannot determine whether the committed work reflects a considered design choice or an abandoned mid-phase state. Recovery cost is the full re-sprint because no phase can be trusted.

The recovery problem compounds: a dispatcher or recovery agent arriving at the scene has no signal about how far execution reached. It must restart from scratch, burning the same discovery/orientation budget again.

## Context

This pattern applies to any agent task that:

- Spans more than one distinct phase (design → implement → verify, or research → draft → edit)
- Has a non-trivial probability of dying before the final deliverable (wall-clock limits, resource constraints, external service dependencies)
- Has a recovery agent or supervisor that must decide whether to re-run or resume

It is most critical for:

- **Sprint agents** with wall-clock limits running multi-step implementation tasks
- **Research agents** accumulating findings across many sources before a synthesis step
- **Documentation or analysis tasks** with many intermediate drafts or data-gathering steps

It is less critical for:

- Trivially short tasks (under ~15 minutes) where the probability of mid-task death is low and the recovery cost of a full restart is acceptable
- Tasks where all phases are idempotent and a full restart costs less than the checkpoint overhead

## Solution

**Publish at milestone boundaries, not only at completion.**

### Core principle

Decouple task execution from task durability. At each natural phase boundary (design complete, core module implemented, tests passing, wiring complete), write a concrete artifact to a durable external surface *before continuing*. Make each checkpoint independently useful: a reader of the checkpointed artifact should be able to continue from there.

### What to checkpoint

| Phase | Durable surface | Example artifact |
|---|---|---|
| Analysis/design complete | GitHub issue comment | Bullet-point design decision + chosen approach |
| Core module implemented | Git commit (pushed to branch); optionally record the commit SHA in an issue comment | Committed file (even without wiring); the commit SHA recorded in an issue comment creates an indexed audit trail — note the commit only remains reachable while a branch or tag still references it |
| Tests written | Git commit (pushed to branch) | Test file committed as a separate, named checkpoint commit |
| Integration wired | Git commit (pushed to branch) | Entry-point change committed |
| Verification complete | GitHub issue comment | Test results summary — prefer issue comments over PR descriptions; PR descriptions are editable and can silently overwrite prior checkpoint content |

### What NOT to do

- ❌ Write the entire implementation in context before making any commits
- ❌ Wait until "it's clean enough to push" — push intermediate, clearly-labelled WIP
- ❌ Rely on scratchpad files in `/tmp` or session state as checkpoints (not durable across agent death)
- ❌ Publish only a status update ("working on step 3…") without a concrete artifact — a status update is not recoverable

### Checkpoint labelling: explicit phase markers

Checkpoints on different surfaces (issue comments, commit messages, PR descriptions) cannot be compared by recency alone. A commit pushed at 14:00 and a comment posted at 14:05 may describe the same phase or different phases — a recovery agent with no prior context cannot tell.

Use explicit phase markers in every checkpoint artifact:

- **Issue comments**: prefix with `[CHECKPOINT: design]`, `[CHECKPOINT: implementation]`, `[CHECKPOINT: verification]`
- **Commit messages**: include the phase name — `feat: [core-module] parsing logic without wiring — checkpoint`
- **PR bodies**: list completed phases as a checklist with completion state (checked = done)

This makes each checkpoint surface independently parseable: a recovery agent finds the highest-phase `[CHECKPOINT: ...]` comment (not simply the most recent artifact by timestamp, which can be misleading when checkpoints land on different surfaces) and reads which phase it represents.

### When the agent dies

A recovery agent reading the durable surface can:
1. Identify exactly which phase completed by locating the highest-phase `[CHECKPOINT: phase-name]` marker across all checkpoint surfaces
2. Resume from that phase (not from scratch)
3. Classify the PR/work-in-progress as "complete-but-unmerged" vs "incomplete WIP" (see [Dead Sprint Recovery](/agent-prompt-patterns/patterns/dead-sprint-recovery))

### Checkpoint granularity

Scale with task duration and risk:

- **Tasks < 15 min**: one final commit/push is sufficient
- **Tasks 15–60 min**: checkpoint at design + implementation + verification (3 checkpoints)
- **Tasks > 60 min**: checkpoint every ~20–30 min of estimated work

### Checkpoint artifact quality

Each checkpoint artifact must be independently readable. A recovery agent should be able to pick up from it without context from prior phases. This means:

- **Issue comments**: include the decision made, not just that a decision was made ("chose approach A over approach B because X", not "decided")
- **Git commits**: commit message must identify the phase boundary ("feat: core module — parsing logic without wiring", not "wip")
- **Draft PRs**: open as draft to signal WIP status; describe which phases are complete and which remain in the PR body

## Evidence

**CONTEXT.md "Sprint Mid-Flight Death Recovery"**: A well-documented recovery protocol for sprints that die mid-flight. The recovery decision (complete-but-unmerged vs incomplete WIP) depends entirely on whether *any* durable artifact was published before death. Sprints that pushed no branch produced nothing recoverable. The classification cannot be made without checkpoints — and a misclassification (treating incomplete WIP as complete) leads to merging half-implemented features.

**realestate-radar #172**: A sprint timed out at 4 hours having never branched. All budget burned on orientation and discovery with zero durable output. Re-dispatch WITH an orientation hint (added to issue body) completed in 34 minutes. The 4 hours of work from the first dispatch left nothing: no branch, no commit, no comment. A single checkpoint commit after the design phase would have preserved at least partial progress.

**cli-wrapper-monitor and factor-dashboard sprint timeouts**: Multiple instances where intermediate library modules or test scaffolding was completed but never committed. Work was unreachable and the full sprint was re-run. In each case, the completed module was implemented from scratch a second time — identical work done twice, with the first run producing nothing recoverable.

**factor-dashboard #99**: A sprint ended with a library module and 38 passing tests committed to a branch, but never wired into the entry point. The checkpoint (the branch push) enabled classification: "complete-but-unmerged core module, wiring phase never started." Recovery re-used the committed module rather than re-implementing it.

## Tradeoffs

**Benefit**: Each checkpoint is an independently recoverable artifact. Recovery cost scales with the *remaining* work, not the *total* work. In the worst case (agent dies after publishing the final checkpoint), recovery is just verify-and-merge.

**Cost**: Checkpointing at phase boundaries adds overhead to task execution. For each checkpoint, the agent must pause the execution flow, compose and publish an artifact, and then resume. For fast tasks this overhead may exceed the benefit.

**Watch out for:**

- **Status updates masquerading as checkpoints**: A comment saying "phase 1 in progress" is not a checkpoint. The artifact must be concrete and independently useful — a committed file, a written decision, a passing test suite. A reader with no prior context must be able to continue from it.
- **Checkpoint granularity mismatch**: Too-frequent checkpoints create noise and slow execution; too-infrequent checkpoints leave large gaps that a recovery agent must reconstruct. Calibrate to task duration (see granularity table above).
- **Checkpoint content over-truncation**: Under time pressure, agents tend to produce minimal checkpoints ("done phase 1"). The value of a checkpoint is in the content — the specific decisions made, the specific code committed, the specific test results. Truncating the content to save time defeats the purpose.
- **Non-durable checkpoint surfaces**: In-context scratchpads, `/tmp` files, and environment variables do not survive agent death. Publish to GitHub (issues, PRs, commits) or other external persistent stores.
- **Commit reachability**: A commit SHA recorded in an issue comment is forensically useful as an audit trail, but the commit only remains reachable (accessible via `git fetch`) while at least one branch or tag still references it. For long-lived checkpoints that must survive branch cleanup, create a named tag or open a draft PR — GitHub retains PR head refs even after the source branch is deleted.
- **Mutable checkpoint surfaces**: PR descriptions can be silently rewritten. For forensic stability, prefer issue comments (lower edit surface, each with a stable individual URL) over PR description text as the primary checkpoint surface.

## Related Patterns

- **[Belief Entropy Checkpointing](/agent-prompt-patterns/patterns/belief-entropy-checkpointing)** — tracks *uncertainty state* (what the agent knows/doesn't know); this pattern tracks *deliverable state* (what has been produced). Complementary, not overlapping: belief-entropy checkpointing tells the recovery agent *how confident* the prior agent was; incremental result checkpointing tells it *how far* the prior agent got.
- **[Atomic Incremental Commits](/agent-prompt-patterns/patterns/atomic-incremental-commits)** — prescribes that code commits be small and atomic; this pattern prescribes *when* to commit (milestone boundaries) and *why* (durability, not just cleanliness). Atomic commits are one mechanism for implementing checkpoints at the code layer.
- **[Dead Sprint Recovery](/agent-prompt-patterns/patterns/dead-sprint-recovery)** — recovery protocol after agent death; this pattern is the proactive complement that makes recovery faster and more complete. Dead Sprint Recovery is the consumer of checkpoints; Incremental Result Checkpointing is the producer.
- **[Execution Budget-Aware Dispatch](/agent-prompt-patterns/patterns/execution-budget-aware-dispatch)** — dispatcher pre-estimates scope and adds orientation hints; this pattern is the in-flight complement ensuring work survives if the budget estimate was wrong. When budget-aware dispatch under-estimates and the agent runs out of time, checkpoints determine how much of the work can be salvaged.
- **[Phase-Gated Epic Body](/agent-prompt-patterns/patterns/phase-gated-epic-body)** — structures multi-phase epics in the issue body; this pattern structures the *execution outputs* of each phase. Phase-gated epic body defines what phases exist; incremental result checkpointing defines how to publish proof that each phase completed.
