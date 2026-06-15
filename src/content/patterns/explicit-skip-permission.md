---
title: "Explicit Skip Permission"
category: "prompt-structure"
evidenceLevel: "moderate"
summary: "Explicitly state in recurring-task prompts that producing no output is a valid outcome. Without this, agents manufacture spurious updates — hallucinating minor changes or repeating prior content reworded to appear fresh."
relatedPatterns: ["empirical-validation-loop", "feedback-loop-via-memory", "observer-actor-separation"]
tags: ["scheduled-tasks", "recurring-agents", "hallucination", "output-stability", "no-op", "idempotency", "prompt-design"]
---

## Problem

An agent runs a recurring task — weekly reflection, daily academic survey, digest generation. Every run, it produces output. After a few runs you notice something wrong: the outputs look suspiciously similar yet never identical. Topics that haven't changed are "updated" with equivalent phrasing. New observations are surfaced that didn't actually happen.

The agent is manufacturing updates.

The root cause isn't a model limitation — it's an implicit prompt contract. The prompt says "review X and update anything relevant." The agent reads this as: _I must find changes, because the task exists to produce output_. When nothing has genuinely changed, the agent invents something to justify the run.

## Context

This pattern applies whenever:

- A task runs on a schedule (daily, weekly, biweekly)
- The task reviews a state space that may not change between runs — memory topics, backlogs, configuration files, market data
- The task historically produces "always-something" output
- Outputs across runs look suspiciously similar but never identical

Signals that manufactured output is occurring:
- Memory topics are rewritten with no meaningful change (same facts, reordered or reworded)
- New observations are added that can't be traced to real events
- "Updated" sections show cosmetic differences only
- Agent creates new memory topics instead of updating existing ones

## Solution

**Explicitly state that "no update" is a valid, expected output.**

Add a skip-permission block to the prompt:

```
After reviewing [scope], if nothing has changed and no action is needed,
respond with exactly: no-update

Do NOT invent changes, pad the response, or repeat prior content to appear active.
```

### Full prompt structure

```
SKIP PERMISSION: If nothing has genuinely changed since the last run,
respond with exactly: no-update — do not manufacture updates.

[rest of task instructions...]

After completing your review:
- If you made meaningful changes: summarize what changed and why.
- If nothing changed: respond with exactly: no-update
```

### Anti-pattern vs. pattern

```
# BAD: implicit requirement to produce output
"Review all memory topics and update any that need changes."

# GOOD: explicit skip permission
"Review all memory topics. Update any that have genuinely changed.
If nothing needs updating, respond with exactly: no-update"
```

The explicit sentinel value (`no-update`) is important. A vague "you can skip if nothing changed" still leaves the agent uncertain — it may interpret any small difference as sufficient justification for output. A specific machine-readable token sets a clear bar.

## Evidence

**Session 1 — `weekly-self-reflect` task (2026-03-04):**

Original prompt: "recall all memory topics and update anything relevant." After 3 runs:
- Agent created new memory topics instead of updating existing ones
- Rewrote sections with no meaningful change — same facts, different phrasing
- Added "observations" that didn't correspond to real events

After adding explicit skip permission: format stabilized immediately. Zero manufactured updates across 6+ subsequent runs. No-op runs consistently produced `no-update`.

**Session 2 — `daily-academic-survey` task (supporting, confounded):**

Paired simultaneously with a dedup instruction (skip papers already in the digest) and skip permission. After 3+ runs, the task reliably produced `no-update` on days with no new relevant papers. Note: because both changes were introduced together, the effect cannot be attributed to skip permission alone — the dedup instruction addresses a related but distinct symptom (already-seen content) and may have been sufficient by itself.

Evidence level `moderate`: Session 1 alone demonstrates the mechanism cleanly — 3 runs showing manufactured output, 6+ runs post-fix with zero manufactured updates. Session 2 is consistent supporting evidence but not independent replication due to the simultaneous change.

## Tradeoffs

**Benefit**: Eliminates manufactured output. Recurring tasks produce signal only when there is genuine signal — no-op runs cost less and produce no misleading content.

**Cost**: The sentinel value (`no-update`) needs downstream handling. If the task output feeds into a digest or notification, the consumer must handle the sentinel gracefully (suppress it, log it, or count consecutive no-ops as a health signal).

**Watch out for**: Over-skipping. If the agent interprets the skip permission too broadly, it may skip runs that should produce output. Mitigate by being specific about what counts as a genuine change: "a new paper in the survey scope," "a memory topic that received new information this week," not "any difference from prior output."

**Interaction effect**: Combine with **Empirical Validation Loop** — run the task 3+ times with and without skip permission to confirm manufactured output is actually occurring before adding the instruction. Without baseline measurement, it's hard to tell whether sparse output reflects correct behavior or over-skipping.

## Related Patterns

- **[Empirical Validation Loop](/agent-prompt-patterns/patterns/empirical-validation-loop)** — measure task outputs across runs to confirm manufacturing before adding the fix; use the same method to verify the fix worked
- **[Feedback Loop via Memory](/agent-prompt-patterns/patterns/feedback-loop-via-memory)** — manifests used by recurring agents are a common target for manufactured updates; skip permission stabilizes manifest writes
- **[Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation)** — separating observation (did anything change?) from action (update the record) makes the skip decision explicit at the architectural level
