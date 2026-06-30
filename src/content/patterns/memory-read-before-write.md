---
title: "Memory Read Before Write"
category: "feedback-loops"
evidenceLevel: "strong"
summary: "Agents that write to shared persistent storage without reading first silently overwrite contributions from other agents or contexts. The pattern: always read a storage location in the current session before saving to it, and verify the topic name before creating new topics. Systems can enforce this with a three-layer guard (never-read, stale-file, stale-context) plus a topic name consistency check and append deduplication discipline."
relatedPatterns: ["feedback-loop-via-memory", "observer-actor-separation", "bounded-autonomy", "strategic-recall-before-ideation", "belief-entropy-checkpointing", "evidence-freshness-decay"]
tags: ["memory", "shared-state", "safety", "multi-agent", "recall", "write-guard", "concurrency", "topic-naming", "lost-update"]
---

## Problem

An agent in workspace A writes a weekly backlog update to a shared `work-pipeline` storage location. Five minutes later, an agent in workspace B runs its standup, sees an action item, and saves an updated `work-pipeline` — overwriting workspace A's changes without reading them.

Workspace A's backlog items are gone. Neither agent knows it happened. The storage location now reflects only workspace B's perspective.

This is the persistent storage equivalent of a git force-push without a pull: concurrent writers operating on shared state with no coordination protocol — the agent-memory equivalent of read-modify-write without optimistic locking in distributed systems.

Five failure modes:

**Never-read write** *(→ Three-layer guard, layer 1)*: An agent has never read the location in the current session but assumes it knows the content from general context ("it's probably the same as before"). It writes, overwriting actual current state.

**Overwrite collision** *(→ Three-layer guard, layer 2)*: Agent B reads a location, another agent writes to it, and then agent B writes — overwriting the intervening change. Layer 2 detects that the underlying data was modified since agent B's read (timestamp or version check) and blocks the write. Note: if two agents read and then write truly simultaneously (race at the storage layer), a best-effort timestamp check can still let one through; for high-contention locations, prefer append-only semantics or storage with CAS/version tokens.

**Stale-read rewrite** *(→ Three-layer guard, layer 3)*: An agent reads a topic at session start, does 20 turns of work, then writes the topic at session end. By turn 47, the read content has scrolled out of the context window and the agent saves based on a stale mental model — regardless of whether other agents have written in the interim. Layer 3 blocks writes when the last read was more than N turns ago (typically 10) and prompts a re-read to refresh context.

**Topic drift** *(→ Topic name consistency check)*: An ideation agent saves to `project-foo-manifest`; the main agent saves to `project-foo-monitor-manifest`; over time the two topics diverge silently — neither agent sees the other's updates. The read-before-write guard cannot catch this if the agent reads the *wrong* topic; a naming check is the matching control.

**Content duplication** *(→ Append deduplication check)*: An agent appends a new log entry without checking if a similar entry was already appended, producing repeated entries (especially common in high-frequency cron jobs that write on every tick). Note: a tail-check reduces but does not eliminate duplicates in highly concurrent scenarios — prefer idempotent entry content or content-addressed deduplication for append-heavy locations.

## Context

This pattern applies to any system where:
- Multiple agents or contexts can write to the same persistent storage
- Storage locations represent shared state (backlog, metrics, manifests, configs)
- The write cost is low enough that agents write frequently without thinking about conflicts

The pattern is less critical for locations that are effectively agent-private (a single agent writes, others only read) or locations that are append-only by convention.

It is most critical for:
- **Shared pipeline/backlog storage** updated by multiple agents across contexts
- **Project manifests** updated by sprint agents and reviewed by human-facing agents
- **Configuration storage** that affects system behavior if corrupted

It is less critical (but still good hygiene) for:
- **Read-only memory access** — no guard needed when you are not writing
- **Append-only log topics** — overwrites aren't possible, but duplicate-entry deduplication still applies (see Content Duplication above)

## Solution

**Before any memory save or patch, always recall the existing topic to establish current state.**

```
# BAD: write-without-read
save_memory(topic="project-manifest", content=my_draft)
→ Overwrites any changes other agents made since my last recall

# GOOD: read-before-write
recall_memory("project-manifest")     # read current state
# ... merge my changes into current state ...
save_memory(topic="project-manifest", content=merged_content)
# OR for surgical changes:
patch_memory(topic="project-manifest", old_str=original, new_str=updated)
```

### Enforcement hierarchy

| Operation | Guard | Preferred approach |
|-----------|-------|--------------------|
| Full topic replace (`save_memory`) | `recall_memory` immediately before | Read → synthesize full content → write; for cross-context rewrites, preserve unfamiliar items from other agents |
| Surgical edit (`patch_memory`) | `recall_memory` to verify `old_str` still matches | Patch only the changed field — minimizes overwrite surface |
| Add items to existing topic | `recall_memory` before, then patch | Surgical append via patch, not full rewrite |
| Append log entry (`append_memory`) | Check last entry to reduce adjacent-duplicate appends | **Best practice**: use idempotent entry content (timestamped or content-addressed) — tail-check alone misses non-adjacent duplicates from retries or out-of-order appends |
| Create new topic | Search for existing similar topic names first | Use `list_memory()` and read candidates before creating |

### Topic name consistency check

Before creating a new topic, scan existing topic names for near-matches using `list_memory()`. Look for topics that share key words, prefixes, or suffixes with the name you intend to create:

```
# Example: want to create "project-cli-monitor-manifest"
list_memory()
# Found: "project-cli-wrapper-monitor-manifest"
# → Don't create a second topic; write to the existing one
```

Near-match detection is judgment-based: if two names share the core noun phrase (e.g., `cli-monitor-manifest`) they are likely the same topic. When in doubt, read the candidate topic first to confirm — topic content is more reliable than name similarity alone.

**Limitation**: `list_memory()` → create is not race-safe. Two agents can independently call `list_memory()`, find no match, and each create a near-duplicate topic. This check *reduces* topic drift when agents are operating sequentially, but does not eliminate it under true concurrency. For high-contention manifest topics, prefer a single designated topic name documented in a shared conventions file.

### Three-layer enforcement (for systems with a code guard)

The three-layer guard provides automated enforcement of the behavioral rule above for **writes to existing topics**. First-write / topic-create operations fall outside the guard by definition and rely on the topic name consistency check above.

1. **Never read**: Storage location exists but has not been read in this session. Block the write.
2. **Stale file**: Location was read, but the underlying data has been modified by another context since that read. Block the write. This is best-effort — a timestamp check catches sequential overwrites reliably but not simultaneous concurrent writes (CAS/version tokens provide stronger guarantees).
3. **Stale context**: Location was read more than N turns ago (typically 10). Content may have scrolled out of the context window. Block the write and prompt a re-read.

**Recency check before writing**: If you read a location more than 10 turns ago and are about to write, re-read first. The content in your context may be stale even if you believe it's current.

## When to Apply

- Any time before calling `save_memory` or `patch_memory`
- When creating a new memory topic (check for near-duplicate names first using `list_memory`)
- Before appending to a frequently-updated log topic (check last entry for duplicates)
- After any significant gap (> 10 turns) between a topic's last recall and an intended write

## Evidence

**Autogent operational pattern**: PLAYBOOK and CONTEXT.md in the Autogent system both carry `recall_memory before save_memory — enforced by code (PR #294) + behavioral habit` as a non-negotiable rule. Root cause of enforcement: repeated lost-update incidents where agents overwrote manifest content that other sessions had added. The code guard (PR #294) was added after behavioral prompting alone proved insufficient.

**Topic name drift observed**: After a 2026-06-28 workspace wipe and reconstruction, an ideation agent saved to `project-wrapper-monitor-manifest` while the main agent used `project-cli-wrapper-monitor-manifest` — creating a split-brain state with diverging manifests that required manual reconciliation. Neither agent detected the divergence until a health audit.

**Production incident**: Two scheduled agents — a standup agent in workspace A and a sprint agent in workspace B — both modified a shared `work-pipeline` storage location within a 20-minute window. The sprint agent read the location, spent 15 minutes on implementation, then saved. The standup agent wrote an update 5 minutes into that window. The sprint agent's save clobbered the standup update. Result: 4 action items lost from the pipeline. Detected only when a health check flagged items as missing that had been explicitly added.

**Stale context write pattern**: Across 30 write operations analyzed in an agent session audit, 8 (27%) were saves to locations read more than 12 turns prior. Of those 8, 3 overwrote changes made by other sessions in the interim. The failure was invisible in all 3 cases — the writing agent reported success with no error.

**Code guard impact**: After implementing the three-layer guard (never read, stale file, stale context), blocked write attempts surfaced 11 would-be clobbering writes in the first 30 days. All 11 resolved correctly after a re-read. Zero data loss incidents in the 60 days following guard deployment.

**Additive vs. full-rewrite comparison**: In 15 full-rewrite operations on a shared backlog location, 4 (27%) resulted in data loss from items added by other contexts between read and write. In 47 patch operations on the same location over the same period: 0 data loss incidents.

## Tradeoffs

**Benefit**: Prevents silent data loss in shared memory. Relatively cheap discipline (one extra read operation) with high protection value. The topic name check additionally prevents the long-tail failure of topic drift, which is invisible until manual reconciliation is required.

**Cost**: Adds a mandatory read-before-write step. In systems with many agents writing frequently to the same topic, the recall overhead adds latency per write cycle.

**Watch out for**:
- **Read + delayed write**: If the read happens at turn 5 and the write happens at turn 45, the content has likely scrolled out of context. Re-read immediately before the write, not at the start of the session.
- **Patch operation on stale data**: Patch operations use text matching; if the target text has changed since read, the patch fails with an error. This is actually a safety feature: treat a patch failure as a signal to re-read.
- **Synthetic "read"**: An agent that knows the storage content from a previous session doesn't substitute for an explicit read in the current session. Prior session memory is not current state.
- **Write amplification**: If the three-layer guard is too aggressive (low stale-context turn threshold), agents spend significant time re-reading. Tune the threshold based on typical session length.
- **Concurrent read-then-write**: Read-before-write alone is not sufficient if two agents can concurrently read the same state and both proceed to write. For high-contention locations, prefer append-only writes or storage systems with version/CAS semantics.
- **Append duplication in crons**: High-frequency cron agents that append on every tick without checking the last entry will accumulate duplicate log entries. Always read the tail of append-only topics before appending.

## Related Patterns

- **[Strategic Recall Before Ideation](/agent-prompt-patterns/patterns/strategic-recall-before-ideation)** — that pattern focuses on recalling memory *before making decisions*; this pattern focuses on recalling memory *before writing* — the write-safety complement. Together they cover the full read → decide → write lifecycle.
- **[Belief-Entropy Checkpointing](/agent-prompt-patterns/patterns/belief-entropy-checkpointing)** — checkpointing produces writes; read-before-write ensures those writes don't clobber concurrent changes. Belief-entropy checkpointing addresses *when* to write; this pattern addresses *how* to write safely.
- **[Feedback Loop via Memory](/agent-prompt-patterns/patterns/feedback-loop-via-memory)** — the manifest pattern depends on safe concurrent writes; read-before-write is the safety layer underneath.
- **[Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation)** — observer writes to memory; actor reads from it — memory safety prevents the actor from seeing overwritten state.
- **[Bounded Autonomy](/agent-prompt-patterns/patterns/bounded-autonomy)** — memory write guards are one implementation of the broader bounded-autonomy principle: constrain the blast radius of any single agent action.
