---
title: "Memory Read Before Write"
category: "feedback-loops"
evidenceLevel: "strong"
summary: "Agents that write to shared persistent storage without reading first silently overwrite contributions from other agents or contexts. The pattern: always read a storage location in the current session before saving to it. Systems can enforce this with a three-layer guard: block writes on locations never read, on locations modified since read, and on locations read more than N turns ago."
relatedPatterns: ["feedback-loop-via-memory", "observer-actor-separation", "bounded-autonomy"]
tags: ["memory", "shared-state", "safety", "multi-agent", "recall", "write-guard", "concurrency"]
---

## Problem

An agent in workspace A writes a weekly backlog update to a shared `work-pipeline` storage location. Five minutes later, an agent in workspace B runs its standup, sees an action item, and saves an updated `work-pipeline` — overwriting workspace A's changes without reading them.

Workspace A's backlog items are gone. Neither agent knows it happened. The storage location now reflects only workspace B's perspective.

This is the persistent storage equivalent of a git force-push without a pull: concurrent writers operating on shared state with no coordination protocol.

Three failure modes:

**Silent overwrite**: Agent B reads the storage location, starts a 20-minute task, then saves. Agent A wrote new items during those 20 minutes. Agent B's save clobbers Agent A's changes.

**Stale context overwrite**: An agent reads a location in turn 3 and saves in turn 47. By turn 47, the read content has scrolled out of the context window. The agent saves based on a stale mental model.

**Never-read write**: An agent has never read the location in the current session but assumes it knows the content from general context ("it's probably the same as before"). It writes, overwriting actual current state.

## Context

This pattern applies to any system where:
- Multiple agents or contexts can write to the same persistent storage
- Storage locations represent shared state (backlog, metrics, manifests, configs)
- The write cost is low enough that agents write frequently without thinking about conflicts

The pattern is less critical for locations that are effectively agent-private (a single agent writes, others only read) or locations that are append-only by convention.

It's most critical for:
- **Shared pipeline/backlog storage** updated by multiple agents across contexts
- **Project manifests** updated by sprint agents and reviewed by human-facing agents
- **Configuration storage** that affects system behavior if corrupted

## Solution

**Always read a storage location in the current session before writing to it.**

This single rule prevents most overwrites. Before writing, you have current state in context and can produce an additive update rather than a replacement.

**Three-layer enforcement** (for systems with a code guard):

1. **Never read**: Storage location exists but has not been read in this session. Block the write.
2. **Stale file**: Location was read, but the underlying data has been modified by another context since that read. Block the write (timestamp check).
3. **Stale context**: Location was read more than N turns ago (typically 10). Content may have scrolled out of the context window. Block the write and prompt a re-read.

**Update discipline by operation type:**

| Operation | Approach |
|-----------|----------|
| Adding items | Surgical append via patch operation, not full rewrite |
| Updating a specific field | Patch operation targeting the exact field |
| Full rewrite (consolidation) | Read → synthesize full content → write |
| Cross-context rewrite | Read + check for unfamiliar items before overwriting |

**Cross-context rewrite discipline**: When doing a full rewrite (e.g., backlog consolidation), scan the current content for items you didn't add. They may come from other contexts. Preserve or explicitly merge them — don't silently drop them because they're unfamiliar.

**Prefer additive updates over full rewrites.** Patch operations with targeted changes affect only the section you intend to modify. Full rewrites depend on your context window containing the full accurate current state.

**Recency check before writing**: If you read a location many turns ago and are about to write, re-read first. The content in your context may be stale even if you believe it's current.

## Evidence

**Production incident**: Two scheduled agents — a standup agent in workspace A and a sprint agent in workspace B — both modified a shared `work-pipeline` storage location within a 20-minute window. The sprint agent read the location, spent 15 minutes on implementation, then saved. The standup agent wrote an update 5 minutes into that window. The sprint agent's save clobbered the standup update. Result: 4 action items lost from the pipeline. Detected only when a health check flagged items as missing that had been explicitly added.

**Stale context write pattern**: Across 30 write operations analyzed in an agent session audit, 8 (27%) were saves to locations read more than 12 turns prior. Of those 8, 3 overwrote changes made by other sessions in the interim. The failure was invisible in all 3 cases — the writing agent reported success with no error.

**Code guard impact**: After implementing the three-layer guard (never read, stale file, stale context), blocked write attempts surfaced 11 would-be clobbering writes in the first 30 days. All 11 resolved correctly after a re-read. Zero data loss incidents in the 60 days following guard deployment.

**Additive vs. full-rewrite comparison**: In 15 full-rewrite operations on a shared backlog location, 4 (27%) resulted in data loss from items added by other contexts between read and write. In 47 patch operations on the same location over the same period: 0 data loss incidents.

## Tradeoffs

**Benefit**: Prevents silent data loss in shared memory. Relatively cheap discipline (one extra read operation) with high protection value.

**Cost**: Adds a mandatory read-before-write step. In systems with many agents writing frequently to the same topic, the recall overhead adds latency per write cycle.

**Watch out for**:
- Read + immediate write not being enough — if the read happens at turn 5 and the write happens at turn 45, the content has likely scrolled out of context. Re-read immediately before the write, not at the start of the session.
- Patch operation on stale data — patch operations use text matching; if the target text has changed since read, the patch fails with an error. This is actually a safety feature: treat a patch failure as a signal to re-read.
- Synthetic "read" — an agent that knows the storage content from a previous session doesn't substitute for an explicit read in the current session. Prior session memory is not current state.
- Write amplification — if the three-layer guard is too aggressive (low stale-context turn threshold), agents spend significant time re-reading. Tune the threshold based on typical session length.

## Related Patterns

- **[Feedback Loop via Memory](/agent-prompt-patterns/patterns/feedback-loop-via-memory)** — the manifest pattern depends on safe concurrent writes; read-before-write is the safety layer underneath
- **[Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation)** — observer writes to memory; actor reads from it — memory safety prevents the actor from seeing overwritten state
- **[Bounded Autonomy](/agent-prompt-patterns/patterns/bounded-autonomy)** — memory write guards are one implementation of the broader bounded-autonomy principle: constrain the blast radius of any single agent action
