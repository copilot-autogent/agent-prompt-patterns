---
title: "Belief-Entropy Checkpointing"
category: "feedback-loops"
evidenceLevel: "emerging"
summary: "Agents that save memory only at session end capture final state but lose decision rationale at earlier branch points. Successful agent trajectories show decreasing uncertainty about task state over time; failed ones show stagnant or increasing entropy. The pattern: checkpoint at high-uncertainty junctures — branch points, reversals, and unexpected outcomes — not only at session end."
relatedPatterns: ["structured-handoff-header", "strategic-recall-before-ideation", "memory-read-before-write"]
tags: ["memory", "checkpointing", "uncertainty", "decision-rationale", "session-state", "branch-points", "reversals"]
---

## Problem

An agent spends 20 turns debugging a concurrency issue. It tries approach B first, discovers a race condition, abandons B, then solves the problem with approach A. At session end, it saves a memory: "Fixed the concurrency issue using approach A."

Next session, the agent faces the same class of problem. It reads its memory, sees "approach A works," but the memory contains no record of *why approach B was rejected*. With no rationale, the agent re-opens the question, tries approach B again, rediscovers the race condition, and wastes 5–7 turns re-deriving already-resolved knowledge.

This is the **decision-rationale loss problem**: end-of-session saves capture the final state of what was done, but miss the branching logic behind it.

Three failure modes stem from end-only checkpointing:

**Re-deriving resolved decisions**: Two valid paths existed; one was chosen for a specific reason. Without a checkpoint encoding that reason, the next session re-opens the question and may reach a different answer — not because the situation changed, but because the rationale was never recorded.

**Missing reversals**: A prior decision turned out wrong mid-task. The agent corrected course. Without a checkpoint at the moment of reversal, the memory only shows the corrected final state — not *what changed* or *why the prior model was wrong*. Future sessions cannot distinguish "this approach was never tried" from "this approach was tried and failed."

**Stagnant uncertainty**: Successful trajectories show *decreasing* uncertainty about task state over time as the agent resolves questions and narrows the solution space. Failed trajectories show stagnant or *increasing* uncertainty — the agent keeps re-opening closed questions. End-only saves cannot detect this regression pattern. Intermediate checkpoints at uncertainty peaks allow the agent to anchor its resolved state explicitly, preventing entropy from accumulating.

## Context

This pattern applies to any multi-turn task where:
- Two or more valid approaches exist and one is chosen over others for a specific reason
- The agent makes an assumption that turns out to be wrong and must reverse course
- A result surprises the agent and updates its model of the system

It is most critical for:
- **Long debugging sessions** where the solution space is narrowed through elimination
- **Architecture decisions** where a chosen design has tradeoffs that are only visible after analysis
- **Investigative tasks** where hypotheses are tested and discarded

It is less critical for:
- **Linear one-shot tasks** with no meaningful branching
- **Trivial writes** with no decision context worth preserving
- **Highly volatile intermediate state** that will be invalid by the next session

## Solution

**Save memory or session checkpoints at high-uncertainty junctures — not just at session end.**

Three trigger conditions identify high-uncertainty junctures:

| Trigger | What to save |
|---------|-------------|
| **Task branch point** | Two or more valid paths existed; one was chosen — record the chosen path, *why the others were rejected*, and the assumptions / system version under which that holds |
| **Reversal** | A prior decision turned out wrong — record what changed, what the corrected model of the system is, and under what conditions the old model was incorrect |
| **Unexpected outcome** | A result contradicts your model — record the inference you made, not the raw output that triggered it, and what system assumptions changed |

Scoping every checkpoint with its governing assumptions is part of the required payload, not a post-hoc note. Future sessions use the scope to decide whether the checkpoint's conclusions still apply after the system has changed.

**Dual-probe anchor question** — apply before every checkpoint write:

1. **Progress component**: "Does this memory clearly encode what has been done / decided?"
2. **Information-gap component**: "Does this memory clearly encode what still needs to happen?" *(For reversals and unexpected-outcome checkpoints where next steps are not yet known, record the updated model of the system rather than speculating. The probe is satisfied by "model updated: X is now known to be false" — it does not require a concrete action list.)*

If either answer is "no" or "unclear", **expand the write** rather than truncating. A memory that answers only one probe is half a memory.

**Summarize, don't paste verbatim.** Record the inference and the rationale, not raw tool output, API responses, or log snippets. Exception: short decision-critical artifacts (exact error codes, config keys, invariant names) that are retrieval anchors can be included — the goal is to avoid pasting noise, not to prevent precise identifiers that distinguish similar failures. **Always redact or omit credentials, PII, customer data, and sensitive paths** before writing to shared persistent memory — mid-session writes increase the surface area for accidental secret persistence.

**Session-end saves remain valuable** — they capture the final state. But intermediate checkpoints capture the branching logic that final state alone cannot reconstruct. Both are better than either alone.

### Branch-point checkpoint example

```
# BAD: session-end-only save
[after 20 turns of debugging, agent saves at end]
Memory: "Fixed the concurrency issue using approach A."

→ Next session: no record of why approach B was tried and rejected.
→ Agent retries approach B, rediscovers the race condition, wastes 5+ turns.

# GOOD: branch-point checkpoint at the decision moment
[after choosing approach A over B because B causes a race condition]
Memory: "Chose approach A over B for concurrency fix.
         Reason: B requires shared mutable state across goroutines →
         race condition on concurrent writes. B is not viable in this
         architecture. A uses immutable message passing; no shared state."

→ Next session: starts directly from A, B is immediately ruled out.
→ 0 wasted turns re-deriving already-resolved knowledge.
```

### Reversal checkpoint example

```
# BAD: no reversal checkpoint
[agent assumed config was loaded from env vars; turns out it's from a file]
[corrects approach; saves final state at session end]
Memory: "Config is loaded from /etc/app/config.yaml."

→ Next session: reads memory, knows the correct path.
→ But has no record that env var approach was tried and failed.
→ Agent may use env vars for a related config and hit the same failure.

# GOOD: reversal checkpoint at the moment of correction
Memory: "REVERSAL: Config is NOT loaded from env vars — assumption was wrong.
         Actual source: /etc/app/config.yaml (file-based config).
         Env var approach produces silent no-op: missing vars are ignored
         rather than raising errors. File-based config for all settings."

→ Next session: env vars are immediately ruled out; silent failure mode is documented.
```

### Dual-probe application

Before writing any checkpoint, apply both probes:

```
Probe 1 (Progress): "Does this memory clearly encode what has been done / decided?"
  → "Chose approach A for concurrency fix" ✓

Probe 2 (Information-gap): "Does this memory clearly encode what still needs to happen?"
  → "Performance profiling of approach A still needed" ✓

Both probes pass → write as-is.

---

Probe 1: "Investigated the issue" — FAIL (too vague; what was found?)
Probe 2: unclear — FAIL (what's the next step?)

Both probes fail → expand before writing.
```

## Evidence

**Belief-entropy research in long-horizon agentic systems**: Successful trajectories show decreasing uncertainty about task state as turns accumulate — questions are resolved and the solution space narrows. Failed trajectories show stagnant or increasing entropy — the same questions are re-opened across turns. Checkpointing at high-uncertainty moments creates a natural feedback mechanism that models a successful trajectory's entropy curve by anchoring resolved state at the point of resolution.

**Autogent operational pattern**: Derived from repeated observation of agents re-deriving already-resolved questions across sessions in the Autogent system. The pattern was added after agents were observed retrying the same failed architectural approaches in consecutive sessions, with no memory of the reversal that had already occurred. The dual-probe anchor question and high-uncertainty juncture save triggers are documented in the system's operational guidelines.

**Decision-rationale preservation principle**: A memory that only answers "what was done" but not "why this was chosen over alternatives" is half a memory. Full checkpoints require both the progress component and the information-gap component to provide the context needed for future sessions to start from the correct state.

**Operational example — race condition rediscovery**: In an observed debugging session, an agent spent 7 turns discovering that approach B was not viable due to a race condition. It saved a session-end memory recording the solution (approach A). In a subsequent session on a related problem, the agent retried approach B, rediscovered the race condition in 6 turns, and arrived at approach A again. A branch-point checkpoint after the original reversal would have reduced the second session's exploration to 0 turns.

## Tradeoffs

**Benefit**: Prevents re-deriving resolved decisions. Amortizes the cost of a prior investigation session across all future sessions that might otherwise repeat it. Captures not just *what* the agent did but *why* — enabling future sessions to rule out rejected paths immediately.

**Cost**: Adds checkpoint writes mid-session. Each write is a tool call with latency. Over-triggering (saving at every minor decision) can flood memory with low-signal checkpoints, making the signal harder to find.

**Watch out for**:

- **Over-triggering on trivial branches**: Not every decision deserves a checkpoint. The trigger condition is "meaningful branch where rationale matters later" — not every if-statement. Use judgment: would a future session realistically try the rejected path without this record?

- **Pasting raw output instead of inference**: A checkpoint that pastes a stack trace or API response is noise. What matters is what you *inferred* from the output: "The stack trace shows that X causes Y under Z condition." Summarize the inference.

- **Assuming session-end saves are enough**: End saves are useful but incomplete. They capture the destination, not the route. The route is what the next session needs when it faces the same branching decision.

- **Writing probes in parallel with the actual write**: The dual-probe check is a gate, not a decoration. If probe 2 fails (unclear what still needs to happen), expanding the write before the task is done is preferable to reconstructing missing context from a partial save later.

- **Confusing "unexpected outcome" with "any surprising result"**: The trigger is specifically when a result *contradicts your model of the system* — i.e., it changes what you believe about how the system works. A result that surprises you but confirms your model does not meet the threshold.

- **Treating checkpoints as universally valid forever**: A checkpoint encodes the rationale under the assumptions and context that held *at the time it was written*. If the system changes materially (library update, schema migration, architecture pivot), old checkpoints should be re-evaluated rather than applied uncritically. Include enough context in the checkpoint (system version, key assumptions) to assess its continued validity.

- **Mid-session writes in shared memory without read-before-write**: Belief-entropy checkpointing increases write frequency mid-session. In shared memory stores, this amplifies the risk of lost-update races. Always follow the Memory Read Before Write pattern — read the target location before writing, especially when writing mid-session rather than at session end. Note that read-before-write alone is not sufficient if two agents can concurrently read the same state and both proceed to write; for high-contention locations, prefer append-only writes or storage systems with version/CAS semantics.

## Related Patterns

- **[Structured Handoff Header](/agent-prompt-patterns/patterns/structured-handoff-header)** — complementary: handoff headers encode state *at dispatch time*; belief-entropy checkpoints encode state *at uncertainty time* within a running session. Together they cover the full state-transfer lifecycle.
- **[Strategic Recall Before Ideation](/agent-prompt-patterns/patterns/strategic-recall-before-ideation)** — the recall side of this pattern; belief-entropy checkpointing is the write side. Recall-before-ideation ensures that checkpointed decision rationale is actually surfaced before the next task begins.
- **[Memory Read Before Write](/agent-prompt-patterns/patterns/memory-read-before-write)** — the concurrency-safety layer for memory writes; belief-entropy checkpointing addresses *when* to write, memory-read-before-write addresses *how* to write safely in shared storage.
