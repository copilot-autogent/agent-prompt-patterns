---
title: "Phase-Gated Epic Body Update"
category: "prompt-structure"
evidenceLevel: "strong"
summary: "After completing each phase of a multi-phase epic, immediately update the issue body to mark the phase complete and redirect agents to the next phase — because the issue body is the agent's prompt, and stale phase instructions cause every subsequent dispatch to re-execute completed work."
relatedPatterns: ["scope-boundary-declaration", "explicit-skip-permission", "dedup-search-before-filing", "long-horizon-task-phasing", "execution-budget-aware-dispatch", "incremental-result-checkpointing"]
tags: ["epics", "prompt-design", "multi-phase", "issue-body", "autonomous-agents", "re-audit-loop", "phase-gating", "task-intake"]
---

## Problem

An epic issue describes a multi-phase workflow: "Phase 1: audit the codebase and identify gaps. Phase 2: implement the sub-issues filed in Phase 1." A sprint agent is dispatched after Phase 1 completes. The agent reads the issue body — its prompt — and re-runs the audit. It files a new round of sub-issues, creating duplicates of the Phase 1 work that already shipped.

Dispatch the agent again: another audit. Another set of duplicates.

**The issue body is the agent's prompt.** When Phase 1 instructions remain in the body, every subsequent dispatch re-executes Phase 1 — regardless of sub-issue state, commit history, or memory topics. The agent has no reliable way to infer that Phase 1 is done unless the body says so.

Two structural properties reinforce this failure:

**Agent memory is not durable.** A sprint agent dispatched on a tick does not inherit the prior sprint's memory of having completed Phase 1. Each dispatch starts fresh from the prompt. If the prompt still says "audit and identify gaps," the agent audits and identifies gaps.

**Sub-issue state is not sufficient.** A sprint agent could theoretically inspect all open sub-issues and infer "Phase 1 must be done because sub-issues exist." In practice, this inference is fragile: the agent doesn't know whether *all* sub-issues were filed, how many to expect, or whether the sub-issues predate Phase 1 at all. Explicit instruction outperforms implicit inference.

**Observed failure signature:**

An epic's Phase 1 completed correctly. Sprint agents dispatched on the next three ticks each re-ran Phase 1, each filed 2–3 "new" sub-issues that were semantic duplicates of the originals, and none began Phase 2 implementation. Six duplicate issues (#764–#769) accumulated before the root cause was identified. Cleanup required: reading each duplicate, confirming overlap with the originals, and manually closing six issues. The re-audit behavior stopped immediately after the issue body was rewritten to mark Phase 1 complete.

## Context

This pattern applies to any multi-phase issue where:

- Autonomous agents are dispatched against the issue (via scheduled crons, webhook triggers, or manual dispatch)
- Phase 1 is a read-only survey or audit — generating a set of sub-issues or artifacts — and Phase 2 is the implementation of those artifacts
- The issue body is the primary instruction surface read by dispatched agents

It is less critical when:

- A human directly manages phase transitions and doesn't rely on dispatched agents reading the issue body
- The dispatch mechanism itself enforces phase gating — for example, a cron that only fires on issues with a specific `status:phase-2` label, meaning Phase 1 agents never receive the issue in the first place. Note: this is different from an agent reading a label *within* the issue body to self-determine its phase — that in-body label check is fragile (the agent can still see and follow Phase 1 instructions before it reads the label) and should not be the sole gate.
- Phase 1 and Phase 2 are the same agent in a continuous session (no dispatch gap, no fresh-context re-entry)

Even in human-managed epics, applying this pattern is low-cost and prevents accidental re-audit if an agent is ever dispatched against the issue.

## Solution

**Immediately after each phase completes, rewrite the issue body to mark the completed phase and explicitly redirect agents to the next phase.**

### Phase transition template

```markdown
## Phase 1: Audit COMPLETE ✅ (YYYY-MM-DD)

Do NOT re-run Phase 1. All audit findings have been filed as sub-issues.
Re-running Phase 1 will create duplicate issues — see #DUP1, #DUP2 for prior run artifacts.

## Phase 2: Implement sub-issues (ACTIVE)

Implement the following sub-issues in order:
- [ ] #N — [title]
- [ ] #M — [title]
- [ ] #P — [title]
```

Replace `#DUP1`, `#DUP2` with the actual issue numbers of any duplicates that were created before the body was updated. If no duplicates were filed, omit the second line of the completion block.

Three elements are required:

**1. Explicit "COMPLETE — do NOT re-run" on the finished phase header.** The phrase "do NOT re-run" is load-bearing. "Phase 1 complete ✅" alone is insufficient — an agent may read it as confirmation that Phase 1 happened, not as a directive to skip it. Explicitly naming the prohibited action removes ambiguity.

**2. A consequence statement if re-run would create duplicates.** Name the duplicate issues by number: "Re-running will create duplicate issues — see #DUP1, #DUP2 for prior run artifacts." This anchors the skip directive with evidence — the agent can inspect those issues and confirm they're duplicates of what it would file. It also makes the dedup risk legible to human reviewers. If no duplicates were filed yet (body updated promptly), omit this line.

**3. An explicit ACTIVE phase with a numbered sub-issue list.** The agent needs to know what to do instead of re-running Phase 1. Name the active phase explicitly and list its sub-issues by GitHub number. A vague "proceed to Phase 2" leaves the agent to infer what Phase 2 means. A numbered list removes that inference step.

### Timing

Update the issue body **at the moment Phase 1 completes** — before the next scheduled tick, before any new sprint is dispatched. The update is not a documentation step; it is the gate that prevents duplicate dispatch. Deferring it risks a tick firing in the window between Phase 1 completion and the body update.

**Concurrency caveat:** The body update closes the gate for future dispatches, but a dispatch that was already queued or mid-flight may have read the stale body before the update was written. Additionally, if two agents (or a human and an agent) update the same epic body concurrently, GitHub's last-writer-wins semantics may overwrite the completion marker, silently reverting the gate. Treat the body update as a best-effort gate: it eliminates all *future* re-audits from agents that read the updated body, but cannot cancel an in-progress dispatch or survive a concurrent overwrite. To cover the in-flight case, pair with [Dedup-Search Before Autonomous Issue Filing](/agent-prompt-patterns/patterns/dedup-search-before-filing) as a defense-in-depth backstop — if the re-audit does run, the dedup search prevents it from actually filing new duplicates.

### When Phase 2 itself completes

Apply the same pattern recursively:

```markdown
## Phase 1: Audit COMPLETE ✅ (2026-06-29)
(see above)

## Phase 2: Implementation COMPLETE ✅ (2026-07-01)

All sub-issues have been implemented and merged. Do NOT re-implement.
Merged PRs: #N (commit abc123), #M (commit def456), #P (commit ghi789).

## Phase 3: Validation (ACTIVE)

Verify the following are working end-to-end:
- [ ] [validation task]
```

The merged PR list serves the same function as the duplicate issue list in Phase 1: concrete evidence the agent can inspect to confirm completion rather than relying on the body's claim alone.

**Pruning long epics.** For epics with many phases, the accumulation of completed-phase blocks can grow large enough to cause context-overflow — recreating the problem this pattern is trying to prevent. After all phases complete, collapse the completed-phase blocks into a single archive summary: "Phases 1–3 complete (see PRs #N, #M, #P). Phase 4 ACTIVE." Keep only the currently-active phase instructions in full. This pruning step belongs in the issue body at the time the final phase closes.

### Anti-patterns

**Leaving Phase 1 instructions in place after Phase 1 completes.** Any agent dispatched against the issue will re-run Phase 1. Even a single re-run can create several duplicate sub-issues that require manual cleanup.

**Marking Phase 1 complete without redirecting to Phase 2.** "Phase 1 complete ✅" without an ACTIVE phase directive leaves the agent without a forward path. It may infer Phase 2 from context — or it may exit without doing anything, or it may re-run Phase 1 as the only action it can identify.

**Using a label as the sole completion signal.** Labels (`status:phase-2`) are not reliably read before the issue body. An agent that reads the issue body first will act on Phase 1 instructions before it ever reaches the label. The issue body is the primary instruction surface.

**Hiding the completion state in comments.** Issue comments are not reliably surfaced when an issue is dispatched as a prompt. A sprint agent reads the issue body (and sometimes linked sub-issues) — not the comment thread. Phase transition must live in the body.

## Evidence

**autogent #741 (2026-06-29):** Epic body described "Phase 1: audit the autogent codebase and identify prompt-engineering gaps; file sub-issues for each gap." Phase 1 completed on the first sprint dispatch. On the next three ticks, dispatched agents re-ran the full audit, each filing 2–3 new sub-issues. Six duplicate issues (#764–#769) were filed before the root cause was identified. The re-audit behavior stopped immediately after the issue body was rewritten to include "Phase 1 COMPLETE — do NOT re-run audit, implement #N next." Zero re-audits occurred on subsequent ticks.

The duplicate cleanup required: reading 6 new issues, identifying their canonical originals, and manually closing each with a "duplicate of" reference. Total cleanup time: ~25 minutes.

**Mechanism confirmed:** The fix was a rewrite of the issue body header to read "Phase 1 COMPLETE — do NOT re-run audit, implement #N next." Crucially, the rewrite *replaced* the Phase 1 audit instructions — it did not merely prepend a checkmark above them. Agents dispatched after the rewrite no longer saw "audit the codebase" in the body and therefore did not audit. This confirms both the mechanism (agents follow what the body says) and the completeness requirement: the rewrite must remove or overwrite the old instructions, not just add a header marker on top.

**Generalization:** Any issue body that describes a read-only survey, analysis, or audit step will produce this failure mode when dispatched against an autonomous agent after the survey is complete. The pattern is not specific to the autogent codebase — it is a structural consequence of using issue bodies as agent prompts with phase-based instructions.

## Tradeoffs

**Benefit:** Stops re-audit loops immediately with a purely textual change — no code required. Prevents duplicate sub-issue accumulation and the cleanup overhead that follows. Provides a clear audit trail: the issue body records what completed, when, and what shipped.

**Cost:** Requires an explicit update step after each phase completes. If the update is deferred or forgotten, the next tick produces another re-audit run. For manually-dispatched agents this is low-risk; for automated crons running every few hours, the update must happen promptly.

**Watch out for:**

- **Forgetting the update during a fast-moving phase transition.** If Phase 1 and Phase 2 are being run by the same operator in the same session, the issue body update can feel like documentation overhead and get deferred. It is not documentation — it is the control gate. The update must precede any further dispatches.

- **Partial updates that still trigger re-audit.** "Phase 1 ✅" in the header is not sufficient if the audit instructions remain in the body below it. An agent reading the full body will still encounter "audit the codebase" and may follow those instructions. Remove or overwrite the audit instructions, don't just prepend a completion marker.

- **Assuming sub-issue state is a sufficient gate.** If sub-issues exist, Phase 1 must be done, right? Not necessarily — the agent cannot reliably infer the complete/incomplete boundary from sub-issue count or state alone. Explicit body instruction is more reliable than any implicit inference from sub-issue state.

- **Confusing phase completion with issue resolution.** The issue body update marks a *phase* as complete, not the issue. The issue remains open until all phases are done. Close the issue only after the final phase completes and all sub-issues are resolved.

## Related Patterns

- **[Scope Boundary Declaration](/agent-prompt-patterns/patterns/scope-boundary-declaration)** — declares what an agent should and should not do within a single task; Phase-Gated Epic Body applies the same clarity principle across multiple dispatches of the same issue, using the issue body to enforce dispatch-time scope. A "do NOT re-run Phase 1" directive is a scope boundary written into the prompt.
- **[Explicit Skip Permission](/agent-prompt-patterns/patterns/explicit-skip-permission)** — gives agents explicit permission to produce no output when nothing has genuinely changed; Phase-Gated Epic Body is the phase-transition equivalent: giving agents explicit instruction to skip a completed phase rather than leaving them to infer completion from context.
- **[Dedup-Search Before Autonomous Issue Filing](/agent-prompt-patterns/patterns/dedup-search-before-filing)** — prevents duplicate issues when an agent re-runs a filing step; Phase-Gated Epic Body is a complementary prevention layer that stops the re-audit from happening at all, rather than catching duplicates after they're filed. The two patterns compose: gate the body to prevent re-audit, and add dedup-search as a defense-in-depth backstop.
- **[Long-Horizon Task Phasing](/agent-prompt-patterns/patterns/long-horizon-task-phasing)** — structures work into phases with explicit completion criteria at the task-design level; Phase-Gated Epic Body implements the phase gate at the issue-body level, translating task-design phase structure into a runtime instruction surface that dispatched agents can read and follow. Long-Horizon Task Phasing defines *how to decompose* multi-session work into phases; Phase-Gated Epic Body defines *how to communicate phase state* to agents that read the issue body as their prompt.
- **[Incremental Result Checkpointing](/agent-prompt-patterns/patterns/incremental-result-checkpointing)** — structures the *execution outputs* of each phase; Phase-Gated Epic Body defines what phases exist and how to gate transitions between them; Incremental Result Checkpointing defines what to publish as proof that each phase completed, making the completion evidence that the phase gate update can reference.
