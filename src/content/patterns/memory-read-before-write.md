---
title: "Memory Read Before Write"
category: "feedback-loops"
evidenceLevel: "strong"
summary: "Agents that write to shared memory topics without reading first silently overwrite contributions from other agents or channels. The pattern: always recall a memory topic in the current session before saving to it. Systems can enforce this with a three-layer guard: block writes on topics never recalled, on topics modified since recall, and on topics recalled more than N turns ago."
relatedPatterns: ["feedback-loop-via-memory", "observer-actor-separation", "bounded-autonomy"]
tags: ["memory", "shared-state", "safety", "multi-agent", "recall", "write-guard", "concurrency"]
---

## Problem

An agent in channel `#dev` writes a weekly backlog update to the `work-pipeline` memory topic. Five minutes later, an agent in `#project-alpha` runs its standup, sees an action item, and saves an updated `work-pipeline` — overwriting the `#dev` agent's changes without reading them.

The `#dev` agent's backlog items are gone. Neither agent knows it happened. The memory topic now reflects only the `#project-alpha` perspective.

This is the memory equivalent of a git force-push without a pull: concurrent writers operating on shared state with no coordination protocol.

Three failure modes:

**Silent overwrite**: Agent B reads the topic, starts a 20-minute task, then saves. Agent A wrote new items during those 20 minutes. Agent B's save clobbers Agent A's changes.

**Stale context overwrite**: An agent recalls a topic in turn 3 and saves in turn 47. By turn 47, the recalled content has scrolled out of the context window. The agent saves based on a stale mental model.

**Never-recalled write**: An agent has never read the topic in the current session but assumes it knows the content from general context ("it's probably the same as before"). It writes, overwriting actual current state.

## Context

This pattern applies to any system where:
- Multiple agents or channels can write to the same memory store
- Memory topics represent shared state (backlog, metrics, manifests, configs)
- The write cost is low enough that agents write frequently without thinking about conflicts

The pattern is less critical for topics that are effectively agent-private (a single agent writes, others only read) or topics that are append-only by convention.

It's most critical for:
- **Shared pipeline/backlog topics** updated by multiple agents across channels
- **Project manifests** updated by sprint agents and reviewed by human-facing agents
- **Configuration topics** that affect system behavior if corrupted

## Solution

**Always `recall_memory` a topic in the current session before `save_memory` to it.**

This single rule prevents most overwrites. Before writing, you have current state in context and can produce an additive update rather than a replacement.

**Three-layer enforcement** (for systems with a code guard):

1. **Never recalled**: Topic exists in the memory store but has not been recalled in this session. Block the write.
2. **Stale file**: Topic was recalled, but the underlying file has been modified by another channel since recall. Block the write (mtime check).
3. **Stale context**: Topic was recalled more than N turns ago (typically 10). Content may have scrolled out of the context window. Block the write and prompt a re-recall.

**Update discipline by operation type:**

| Operation | Approach |
|-----------|----------|
| Adding items | `patch_memory` — surgical append, not full rewrite |
| Updating a specific field | `patch_memory` with old_str/new_str targeting the exact field |
| Full rewrite (consolidation) | `recall_memory` → synthesize full content → `save_memory` |
| Cross-channel rewrite | `recall_memory` + check for unfamiliar items before overwriting |

**Cross-channel rewrite discipline**: When doing a full rewrite (e.g., backlog consolidation), scan the current content for items you didn't add. They may come from other channels. Preserve or explicitly merge them — don't silently drop them because they're unfamiliar.

**Prefer additive updates over full rewrites.** `patch_memory` with a targeted `old_str/new_str` affects only the section you intend to change. Full `save_memory` rewrites depend on your context window containing the full accurate current state.

**Recency check before writing**: If you recalled a topic many turns ago and are about to write, re-recall first. The content in your context may be stale even if you believe it's current.

## Evidence

**Production incident (autogent work-pipeline, May 2026)**: Two scheduled tasks — `standup` in `#dev` and a sprint agent in `#project-alpha` — both modified `work-pipeline` within a 20-minute window. The sprint agent read the topic, spent 15 minutes on implementation, then saved. The standup agent wrote an update 5 minutes into that window. The sprint agent's save clobbered the standup update. Result: 4 action items lost from the pipeline. Detected only when a health check flagged items as missing that had been explicitly added.

**Stale context write pattern**: Across 30 memory write operations analyzed in an autogent session audit, 8 (27%) were saves to topics recalled more than 12 turns prior. Of those 8, 3 overwrote changes made by other sessions in the interim. The failure was invisible in all 3 cases — the writing agent reported success with no error.

**Code guard impact (PR #294)**: After implementing the three-layer guard (never recalled, stale file, stale context), blocked write attempts surfaced 11 would-be clobbering writes in the first 30 days. All 11 resolved correctly after a re-recall. Zero data loss incidents in the 60 days following guard deployment.

**Additive vs. full-rewrite comparison**: In 15 full-rewrite operations on a shared backlog topic, 4 (27%) resulted in data loss from items added by other channels between recall and write. In 47 patch operations on the same topic over the same period: 0 data loss incidents.

## Tradeoffs

**Benefit**: Prevents silent data loss in shared memory. Relatively cheap discipline (one extra `recall_memory` call) with high protection value.

**Cost**: Adds a mandatory read-before-write step. In systems with many agents writing frequently to the same topic, the recall overhead adds latency per write cycle.

**Watch out for**:
- Recall + immediate write not being enough — if the recall happens at turn 5 and the write happens at turn 45, the content has likely scrolled out of context. Re-recall immediately before the write, not at the start of the session.
- `patch_memory` on a stale topic — patch operations use old_str matching; if the target text has changed since recall, the patch fails with an error. This is actually a safety feature: treat a patch failure as a signal to re-recall.
- Synthetic "recall" — an agent that knows the topic content from a previous session doesn't substitute for an explicit `recall_memory` call in the current session. Prior session memory is not current state.
- Write amplification — if the three-layer guard is too aggressive (low stale-context turn threshold), agents spend significant time re-recalling. Tune the threshold based on typical session length.

## Related Patterns

- **[Feedback Loop via Memory](/agent-prompt-patterns/patterns/feedback-loop-via-memory)** — the manifest pattern depends on safe concurrent writes; read-before-write is the safety layer underneath
- **[Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation)** — observer writes to memory; actor reads from it — memory safety prevents the actor from seeing overwritten state
- **[Bounded Autonomy](/agent-prompt-patterns/patterns/bounded-autonomy)** — memory write guards are one implementation of the broader bounded-autonomy principle: constrain the blast radius of any single agent action
