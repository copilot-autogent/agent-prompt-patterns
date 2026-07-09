---
title: "Ambiguity Threshold Clarification"
category: "task-design"
evidenceLevel: "strong"
summary: "When an agent receives an underspecified or ambiguous instruction, it needs a principled threshold for when to stop and ask vs. proceed with a documented inference. Without one, agents either over-ask (friction, kills autonomous value) or under-ask (wrong-scope work, wasted sprints, reverts). Apply a two-branch decision rule: ask when ambiguity touches ≥50% of deliverable scope or a constraint-class field; infer when the ambiguity is an implementation detail and the conservative path is safe and reversible. When asking, always propose a specific default. When inferring, always surface it."
relatedPatterns: ["scope-boundary-declaration", "explicit-skip-permission", "bounded-autonomy", "decision-ownership"]
tags: ["clarification", "ambiguity", "inference", "scope", "ask-before-guessing", "autonomous-agent", "task-design", "underspecified-instructions"]
---

## Problem

Agents frequently receive instructions that are underspecified: the intent is clear but a key element — scope boundary, data format, constraint, or output target — is left undefined. The agent must choose between two modes:

- **Ask**: Stop, surface the ambiguity, request clarification before proceeding.
- **Infer**: Make a documented assumption and proceed.

Without a principled threshold, both failure modes are common:

**Over-asking**: The agent flags every minor implementation detail as a clarification request. This creates high-friction interactions, slows autonomous execution to a crawl, and transfers decision load back to the operator — undermining the entire value of autonomous agents. Operators lose trust in the agent's ability to make routine choices.

**Under-asking**: The agent silently selects an interpretation and executes — sometimes thousands of lines of work — before the misalignment surfaces. Subsidy-radar data-format assumptions, factor-dashboard autonomous feature ideation, and shogi-srs difficulty-personalization sprints all shipped misaligned deliverables that required reverts or complete re-sprints because the wrong interpretation was chosen silently and never flagged.

The cost asymmetry is non-linear: a 2-minute clarification exchange can prevent a 4-hour sprint that produces work the operator must throw away.

## Context

This pattern applies whenever an agent receives a task where one or more elements are ambiguous, contradictory, or undefined. It is most critical for:

- **Sprint kickoffs** where scope or output format is unclear before the first code change
- **Destructive or irreversible operations** (deletions, external API calls, schema changes)
- **Cross-project work** where domain defaults may differ
- **Instruction updates** where the delta is ambiguous ("make it faster" could mean algorithm, caching, or infra)

The pattern does NOT apply when instructions are fully specified; it is a triage filter, not a general-purpose asking protocol.

## Solution

### Step 1 — Ask or Infer Decision

Apply both criteria in parallel. If **any** ask-trigger fires, ask. Only infer when **all** infer-conditions hold.

**Ask when:**

1. **Scope impact ≥50%**: The unclear element affects the majority of the deliverable. If the ambiguity determines what to build rather than how to build it, the agent cannot safely begin.
2. **Constraint-class field**: The ambiguity is in one of these categories — security boundary, destructive/irreversible action, external API contract, data schema definition. Errors in constraint-class fields are expensive and may be unrecoverable.
3. **Incompatible interpretations with no safe default**: Two plausible readings produce outputs that cannot be merged or reconciled. There is no single "most conservative" path — both paths are risky and different.

**Infer when all three hold:**

1. **Implementation choice, not scope choice**: The ambiguity determines *how* to achieve an agreed outcome, not *what* outcome to produce.
2. **Conservative interpretation is safe and reversible**: The most cautious reading produces an artifact that can be corrected or extended without significant cost.
3. **Resolves by domain default**: The ambiguity has a well-established default in the domain (e.g., "append" for an unspecified file write mode, "read-only" for an unspecified DB access pattern, RFC-recommended defaults for protocol behavior). Note: "latest stable" for dependency versions is **not** a safe default — it produces non-reproducible builds. Prefer an explicit pinned version or ask.

### Step 2 — When Asking: Ask Well

Never surface ambiguity as an open-ended question. Open-ended questions ("what do you want for X?") transfer all cognitive load to the operator and produce no forward motion.

**Format for asking:**

1. **Name the ambiguity explicitly**: State the two (or more) interpretations with the consequence of each.
2. **Propose a specific default with a time window**: "I'll proceed with [default] unless you correct me within [N hours / by [time]]." This unblocks work on a timer and gives the operator a concrete position to accept or reject.
   - **Exception — constraint-class ambiguities do not get a timeout default.** If the ask was triggered by a security boundary, destructive/irreversible action, external API contract, or schema change, the agent must block until the operator explicitly confirms. A timeout expiry must NOT authorize irreversible work; instead, re-ask or park the task as `status:needs-input`.
3. **One question per ask**: Do not batch multiple clarifications into one message. Each ambiguity is an independent decision. Batching forces the operator to parse a compound question and increases the chance of a partial or ambiguous answer. *Exception: when two ambiguities are tightly coupled — resolving one constrains the other — surface both together, but label them clearly as related and accept an answer to either.*

**Example:**

> The issue asks for "a new data pipeline" — this could mean (a) a standalone ingestion script or (b) a fully wired module integrated into the existing ETL. These produce incompatible directory structures. I'll proceed with (a) a standalone script unless you redirect me within 4 hours.

### Step 3 — When Inferring: Surface It

Inferences made silently create no feedback path. If the inference is wrong, the operator has no early signal to intervene before deep work is done.

**Required inference logging:**

- **In the task summary header**: State the inference before describing implementation. "Assuming X because Y."
- **Flag as revisable**: "Override with Z if you prefer."
- **Do not bury in footnotes**: The inference statement must be visible in the first screen of any task summary, not in an appendix.

**Example:**

> **Inference**: write mode set to `append` (not `overwrite`) because no mode was specified and `append` is the safe domain default. Override: set `WRITE_MODE=overwrite` in the env file if a clean rewrite is intended.

### Decision Tree (Summary)

```
Ambiguous instruction received
          │
          ├─ Does ambiguity affect ≥50% of scope?  ──YES──► Ask (with default if non-constraint-class)
          │
          ├─ Is it a constraint-class field?        ──YES──► Ask (NO timeout default; block until confirmed)
          │     (security, destructive, API, schema)
          │
          ├─ No safe default / incompatible paths?  ──YES──► Ask (with default)
          │
          ├─ All infer conditions met?              ──YES──► Infer + log
          │     (impl detail, reversible, domain default)
          │
          └─ None of the above clearly applies?    ──────► Gather more context first:
                                                             check prior commits, related patterns,
                                                             domain docs, then re-apply the tree.
                                                             If still unresolved → Ask.
```

## Evidence

**autogent PLAYBOOK `when-triaging-feedback`**: Encodes "ask-before-guessing" as a non-negotiable rule derived from multiple observed sprint failures. The rule was promoted from a guideline to a non-negotiable after repeated incidents where agents made scope assumptions that invalidated entire sprint outputs.

**factor-dashboard retro**: Identified "building without a scoped question answered" as the root cause of 70 feature implementations with no information architecture, producing a 67-panel dashboard that was functionally unusable. None of the 70 features was technically wrong; the scope itself was never confirmed. A single clarification question at the ideation stage ("which user question does each of these panels answer?") would have filtered out most of the unnecessary work before any code was written.

**shogi-srs difficulty-personalization sprints**: Multiple sprints implemented incompatible interpretations of "personalized difficulty" (adaptive algorithm vs. user-settable levels vs. spaced-repetition weight tuning). Each sprint required a revert or full re-sprint because the interpretation was chosen silently. The combined wasted sprint time exceeded the time that would have been spent on a single clarification round at the start.

**subsidy-radar data-format assumptions**: Sprint assumed a specific column layout for Taiwan government CSV data that had shifted in a mid-season format update. The assumption was made without surfacing it; the error was caught only at the geocoding stage after 500 failed address lookups. A logged inference ("assuming 28-column format — override if gov CSV layout has changed") would have surfaced the mismatch at review time, not post-execution.

**Ask-with-default effectiveness**: Across tracked sprint interactions, clarification asks that included a specific default proposal and time window received actionable responses within the window ~90% of the time. Open-ended asks ("what format do you want?") left agents blocked for 2× longer on average and frequently required follow-up messages to extract a concrete answer.

## Tradeoffs

**Latency vs. correctness**: Asking introduces latency. On a constrained time budget (e.g., 4-hour sprint), asking and waiting may consume a significant fraction of the available window. The ≥50% scope threshold is calibrated to this tradeoff: only ask when the ambiguity affects enough of the deliverable that proceeding incorrectly would waste more time than the ask itself.

**Inference logging overhead**: Surfacing every inference adds words to task summaries. For long tasks with many minor inferences, this can add noise. Filter to inferences that meet the domain-default bar — inferences below that bar (e.g., alphabetical sort order for a list) don't need explicit logging. Only inferences that could plausibly be overridden by operator preference need to be surfaced.

**Over-asking creep**: Teams that adopt this pattern sometimes recalibrate the threshold too conservatively, asking about implementation details that clearly fall below the 50% scope bar. The constraint-class check is the correct filter for these edge cases — if it's not a constraint-class field and scope impact is below 50%, infer.

**Single-question discipline**: Asking one question per ambiguity is slower than batching. The benefit is a higher-quality, unambiguous response. Batched questions frequently receive partial answers that produce new ambiguity. The time cost of single-question discipline is almost always recovered by avoiding follow-up clarification rounds.
