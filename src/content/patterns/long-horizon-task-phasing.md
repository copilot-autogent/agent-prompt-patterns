---
title: "Long-Horizon Task Phasing"
category: "multi-agent"
evidenceLevel: "strong"
summary: "Tasks spanning more than one session or agent suffer from context overflow and cross-session blindness. The pattern: decompose multi-session work into bounded phases, each with a clear gate artifact and a structured handoff document. The next phase loads only the handoff — not the full prior history — so every session starts with a signal-to-noise ratio close to 1."
relatedPatterns: ["structured-handoff-header", "sprint-continuity", "belief-entropy-checkpointing", "workspace-per-sprint-isolation", "context-window-budgeting", "phase-gated-epic-body"]
tags: ["planning", "multi-session", "phasing", "handoff", "context-overflow", "cross-session", "phase-gate", "long-horizon", "decomposition"]
---

## Problem

A task is filed as a single issue: "Audit the codebase, implement the changes, ship the feature, deploy and verify." The sprint starts. Twelve sessions later — some timed-out, one after a memory wipe — the task is still open. The next session re-runs the audit.

Two structural failure modes drive this outcome:

**Context overflow**: The full task history no longer fits in one context window. Early decisions, rejected approaches, and completed sub-tasks are silently truncated. The agent operates on an incomplete picture and may repeat or contradict work already done.

**Cross-session blindness**: A resumed session has no structured record of what the previous session accomplished. It re-reads all available context — channel history, GitHub comments, memory topics — and re-derives state from scratch. This re-derivation is expensive, lossy, and prone to divergence.

**Observed failure signatures:**

- **Phase re-runs**: Sprint agents re-executed Phase 1 audits on consecutive dispatches because the epic body described Phase 1 in detail. The dispatch context made Phase 1 look like the current assignment.
- **Wipe recovery waste**: After a memory wipe, sessions spent 3–5 turns re-discovering project state that had never been written to a durable, structured handoff.
- **Decision drift**: A resumed session reached a different architectural conclusion than the previous session because the rationale for the first decision was only in terminal output, not in a durable handoff. Both decisions were internally consistent; neither was wrong — but they were incompatible.

The common root cause is treating the session boundary as incidental rather than as an explicit design boundary. A task that spans sessions has inter-session state transfer requirements. Those requirements are not met by accident.

## Context

This pattern applies to tasks that satisfy one or more of the following:

- Estimated to exceed 50 tool calls or more than one working session
- Requires work to be split across multiple agent dispatches (sprint agents, scheduled tasks, parallel workers)
- Involves distinct phases that produce verifiable artifacts (merged code, deployed feature, saved analysis)
- Has been re-opened or re-attempted after an interruption (timeout, memory wipe, context loss)

It is most critical for:
- **Audit → implement → deploy rollouts** where each phase depends on the previous phase's verified artifact
- **Batch operations** (filing N issues, publishing N patterns) where a single session cannot complete the full batch
- **Research → specification → implementation flows** where the output of one phase is the specification for the next

It is less applicable to:
- Single-session tasks where the entire scope fits comfortably in one context window
- Tasks with a single, linear execution path and no meaningful phase boundaries
- Trivial writes with no decision context worth preserving across sessions

## Solution

**Decompose the task into bounded phases at intake. Each phase ends with a verifiable artifact and a structured handoff document. Each phase begins by loading only the handoff — not the full prior history.**

### 1. Phase decomposition at intake

When a task is likely to span more than one session, split it into phases during initial triage — before dispatching the first agent. Each phase must satisfy:

- **Single, tangible artifact**: the phase is not complete until the artifact is verifiable (PR merged, deploy confirmed, memory saved). "I believe I completed X" is not an artifact.
- **Clear entry condition**: the phase can be started by an agent that has read only the handoff document and the current phase specification — no other context required.
- **Bounded scope**: the agent can complete the phase in one session without running against context limits.

**Phase decomposition template:**

```
Task: [task title]
Phase 1: [name] — produces [artifact]
Phase 2: [name] — requires [Phase 1 artifact], produces [artifact]
Phase 3: [name] — requires [Phase 2 artifact], produces [artifact]
```

A phase may be skipped if its precondition artifact already exists. Do not re-execute a phase whose artifact is already verified.

### 2. Handoff document at phase completion

Before ending a phase, write a structured handoff and store it in a durable location (GitHub epic body or a named memory topic — not local terminal output or Discord messages that may be lost to wipe or context scroll).

**Handoff format:**

```
Phase N COMPLETE — [one-sentence summary of what was done]
Artifact: [PR #N merged {sha} | deploy {url} confirmed | memory topic {name} saved]

Phase N+1 goal: [concrete one-sentence goal]
First step: [the exact first action the next session should take]
Required context: [list only what the next session must load — files, memory topics, issue numbers]

Key decisions made:
- [decision 1 and rationale — enough for next session to not re-open it]
- [decision 2 and rationale]

Do NOT re-run Phase N. It is complete. Evidence: [artifact reference].
```

The "Do NOT re-run" line is not optional. Without it, a resumed session that reads the epic body — which still describes Phase N — will treat Phase N as the current assignment. The explicit prohibition is the guard.

**Where to store the handoff:**

| Location | When to use |
|---|---|
| GitHub epic body (replace Phase N description with "COMPLETE — [artifact]") | Always — this is the primary source the sprint supervisor reads at dispatch time |
| Named memory topic (`task-phasing-{issue}`) | For large or complex handoffs where the epic body would become unwieldy |

Both locations should be written if the task is complex. If the epic body is the only location and a memory wipe occurs, the handoff survives in GitHub.

### 3. Context-budget allocation per phase

At the start of each phase, load only:

1. The handoff document from the completed phase
2. The current phase's specification (scope, success criteria, first step)
3. Any specific files or memory topics explicitly listed in the handoff's `required_context`

Do **not** load:
- The full task history
- Prior phases' detailed descriptions
- Channel history from previous sessions (unless the handoff explicitly references a specific message)

This constraint is the mechanism that prevents context overflow. The handoff document is the interface contract between phases; everything behind it is implementation detail that no longer needs to be in-context.

### 4. Phase gate verification

A phase is not complete until its artifact is independently verifiable. Verification is not optional and cannot be self-asserted.

| Phase type | Required artifact | Verification method |
|---|---|---|
| Audit / research | Memory topic or saved document | `recall_memory(topic)` returns the findings |
| Implementation | Merged PR with SHA | `git log` on the target branch confirms SHA; the change is visible at the expected location in the repo |
| Deploy / release | Verified live URL | `verify_deploy(url)` returns `ok: true`, 0 JS errors |
| Batch operation | Issue count or updated manifest | GitHub issue search or manifest `grep` confirms N items filed |

**Artifact link is part of the handoff.** A handoff that says "Phase 2 is complete" without an artifact reference cannot be verified by the next session and should be treated as incomplete.

### Phase anatomy

| Phase component | Entry condition | Gate artifact | Handoff update |
|---|---|---|---|
| Audit / research | Task intake | Memory topic or saved analysis | "Audit complete — findings in `memory:topic`" |
| Specification | Audit artifact exists | Issue or spec document | "Spec filed — issue #N" |
| Implementation | Spec document exists | Merged PR + SHA | "Impl complete — PR #N merged `{sha}`" |
| Deploy / release | Merged PR exists | Verified live URL | "Deploy confirmed — `{url}` live, 0 JS errors" |
| Batch refill | Prior batch exhausted | Issue count or manifest entry | "Batch refilled — issues #N–#M filed" |

### Anti-patterns

**Describing Phase N work in the Phase N+1 epic body**: causes Phase N to be re-run on every dispatch. Fix: replace Phase N description in the epic body with "Phase N COMPLETE — [artifact reference]. Do NOT re-run."

**Saving the handoff only in local memory or terminal output**: lost after a wipe or context scroll. Handoffs must be durable — GitHub or a named memory topic.

**Declaring a phase complete without verifying the artifact**: the next phase starts on an unverified assumption. Every subsequent phase inherits the error. Verify before writing the handoff.

**Loading full prior history at phase start**: defeats the context-budget constraint. The session starts with a bloated context that triggers the same overflow the phasing was designed to prevent.

**Setting phases too granularly**: a phase that can be completed in 5 tool calls does not need its own handoff. Reserve phase boundaries for points where a verifiable artifact is produced and the state genuinely needs to be transferred.

## Evidence

**Epic re-audit loop (#741)**: A sprint supervisor dispatched agents to continue a multi-phase rollout. The epic body still contained the full Phase 1 audit description. Agents re-ran the Phase 1 audit on three consecutive dispatches, filing six duplicate issues (#764–#769) before the epic body was updated to explicitly say "Phase 1 COMPLETE — do NOT re-run."

**Memory-wipe recovery**: After a memory wipe, sessions spent 3–5 turns reconstructing project state from channel history and GitHub issues. Sessions that had written structured handoffs to the GitHub epic body recovered in under one turn. Sessions with handoffs only in memory recovered nothing.

**Decision drift from rationale loss**: An agent made an architectural choice in session N, with rationale visible only in session N's terminal output. Session N+1, lacking the rationale, re-opened the architectural question and reached a different (internally consistent) conclusion. The two decisions conflicted. The conflict was only discovered when the implementation attempted to reconcile them.

**Belief-entropy research**: Successful long-horizon trajectories show decreasing uncertainty about task state as phases complete — each phase gate anchors a resolved portion of the task space. Failed trajectories show stagnant or increasing uncertainty — the same questions are re-opened across sessions because no anchor was written.

## Tradeoffs

**Benefit**: Each phase boundary creates a verifiable anchor in the task's state space. Future sessions do not re-derive state behind the anchor. Context windows are allocated to forward progress, not reconstruction. Phase gates expose completion claims to verification before work continues.

**Cost**: Phase decomposition adds upfront planning overhead. Writing and storing handoff documents adds per-phase overhead. If the task turns out to be shorter than estimated (fits in one session), the phasing machinery was unnecessary friction.

**Watch out for:**

- **Phase explosion**: decomposing a 2-hour task into 8 phases creates handoff overhead that exceeds the task's own cost. Use phase boundaries at natural artifact-producing checkpoints, not at arbitrary turn counts.

- **Handoff document drift**: the handoff is written once and read later. If the situation changes between write and read, the handoff may be stale. Include enough context (commit SHA, issue numbers, memory topic versions) for the next session to detect staleness.

- **Phantom completion**: an agent declares a phase complete because it "believes" the artifact exists. The next phase starts and discovers the artifact is missing or incomplete. Always verify artifacts before writing the handoff. "I ran the deploy command" is not the same as `verify_deploy(url)` returning `ok: true`.

- **Gate overfitting**: defining phase gates only around technical checkpoints (PR merged, deploy verified) but missing cognitive checkpoints (key decision made, analysis complete). A phase whose artifact is "key architectural decision made and rationale saved" is a valid phase — the artifact is the saved decision, and the gate is `recall_memory` returning it.

## Related Patterns

- **[Structured Handoff Header](/agent-prompt-patterns/patterns/structured-handoff-header)** — the micro-pattern for encoding state at dispatch time; Long-Horizon Task Phasing is the macro-composition pattern that orchestrates multiple handoff cycles across phases. Use structured handoff headers *within* each phase dispatch, and the phase handoff document *between* phases.
- **[Sprint Continuity](/agent-prompt-patterns/patterns/sprint-continuity)** — complementary for recurring agents; sprint continuity addresses the within-manifest session boundary (what the same recurring agent transfers to its own next run); long-horizon task phasing addresses the across-agent phase boundary (what one phase's work transfers to the next phase's agent).
- **[Belief-Entropy Checkpointing](/agent-prompt-patterns/patterns/belief-entropy-checkpointing)** — the within-session checkpoint pattern; belief-entropy checkpointing fires at branch points and reversals *within* a session; long-horizon task phasing fires at phase *completion* boundaries *between* sessions. Both are needed: within-session for decision rationale; between-session for phase state.
- **[Workspace-per-Sprint Isolation](/agent-prompt-patterns/patterns/workspace-per-sprint-isolation)** — the working-directory isolation pattern for parallel sprint agents; long-horizon task phasing ensures phase sequencing and handoff; workspace isolation ensures that parallel agents in the same phase don't contaminate each other's working trees.
- **[Context Window Budgeting](/agent-prompt-patterns/patterns/context-window-budgeting)** — directly implements the context-budget allocation step; use context-window budgeting to determine phase size limits and to structure the per-phase load list.
