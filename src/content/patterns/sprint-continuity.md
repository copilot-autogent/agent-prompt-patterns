---
title: "Sprint Continuity"
category: "feedback-loops"
evidenceLevel: "strong"
summary: "A recurring agent's session boundary is only as reliable as the handoff document it writes and reads. Structure your manifest to encode exactly the decisions, state, and open items the next session needs — nothing more. Agents that trust their own prior output run faster and make better decisions than agents that re-derive state from scratch."
relatedPatterns: ["feedback-loop-via-memory", "context-window-budgeting", "pre-commit-planning-phase"]
tags: ["continuity", "memory", "handoff", "recurring", "sprint", "manifest", "state", "sessions"]
---

## Problem

You have a recurring autonomous agent — a weekly sprint, a daily researcher, a periodic maintenance task. Each run starts fresh. The agent has no memory of what it decided, what it shipped, or what it deferred. It re-reads all available context, re-derives state, and makes decisions that may conflict with its own prior work.

Three failure signatures:

**Redundant re-derivation**: The agent spends 40% of its session reading the same memory it read last time to reach the same conclusions. No new information was incorporated. The "investigation" phase is pure waste.

**Conflicting decisions**: Two consecutive sessions make opposite choices because neither had a clear record of the prior decision's rationale. The second session saw a different subset of signals and concluded differently.

**Lost deferred work**: Session N identifies work it can't complete and says "handle next session." Session N+1 has no record of this and picks from the backlog instead. The deferred item is silently dropped.

The root cause is treating the session boundary as incidental — something to work around rather than explicitly design for.

## Context

This pattern applies to any agent that runs on a recurring schedule and must maintain coherent direction across independent sessions:

- Sprint agents executing multi-week project roadmaps
- Research agents building on prior findings across daily runs
- Maintenance agents tracking cumulative system state
- Any agent where "what happened last time" matters to "what to do this time"

It's especially important when the agent shares a memory store with other agents (multiple channels, parallel pipelines) — because the session boundary is where conflicts originate.

## Solution

**Treat the manifest (handoff document) as the primary product of every session, not a side effect.**

The manifest encodes the minimum state the next session needs to act without re-deriving it. It has three required sections and two optional ones:

**Required:**

**1. Published/completed work** — an append-only ledger of what exists and where. No session should need to re-verify that pattern #7 was published on May 12 — the manifest says so. Include: item identifier, date, commit/artifact reference. Never delete entries; mark them `✅` instead.

**2. Backlog in priority order** — the *current* ordering, not the original ordering. Sessions reorder based on what they learned. The manifest must reflect the latest ordering, or the next session will revert to the original. Include enough context in each item to act without additional investigation (evidence source, specific implementation detail, why it's prioritized here).

**3. Open items with explicit handoff signal** — anything the current session identified but did not complete. Use a specific format: `[HANDOFF] item description — reason not completed — what next session should do first`. Distinguish from backlog: handoff items are *started*, backlog items are *planned*.

**Optional but high-value:**

**4. Gotchas** — environment quirks, schema constraints, known failure modes discovered empirically. These prevent the next session from repeating the same mistake. Short entries only; if it needs more than 2 lines, it belongs in a dedicated memory topic.

**5. Sprint history** — the last 5–7 sprints with what changed. Gives the next session calibration: "are we on a good trajectory?" One row per sprint, commit hash as anchor.

**Discipline rules:**
- Write the manifest update as the **last action** of every session, after all work is committed
- Keep total manifest size under ~3KB — it's loaded into every session's context budget; bloat hurts every future run
- When you find an item in the manifest that's been superseded, update it in place rather than appending a correction — the manifest is live state, not a log

## Evidence

An autonomous agent system running a recurring sprint task across 6+ weeks provided direct evidence for this pattern through both its successes and failures:

**Continuity success (5 consecutive sprints)**: Each sprint agent loaded the manifest, found the published-patterns table, identified backlog #1, and began writing within the first 10% of its session. No re-investigation of what already existed. No redundant re-reading of all 11 prior patterns. Average investigation phase: ~5% of session budget.

**Continuity failure (manifest corruption)**: An initiative agent wrote to the manifest using non-schema category values and a conflicting patterns table. The next sprint agent loaded a document with two contradictory "Published Patterns" sections. Resolution required reading both, identifying the canonical one, and manually reconciling — consuming ~25% of the session before any productive work began. Root cause: the manifest was treated as a log (append) rather than live state (update in place).

**Deferred item drop (three instances)**: Sprint sessions that said "handle next session" without writing an explicit `[HANDOFF]` entry in the manifest had a 0% carry-forward rate across 15 measured sessions. Sprint sessions that wrote a specific manifest entry had a 100% carry-forward rate. The mechanism matters: intent without a record is dropped; a manifest entry is picked up.

**Manifest bloat effect**: One sprint cycle accumulated a 7KB manifest from redundant bug entries, duplicate backlog items, and accumulated sprint history. The following session spent measurably more context on the manifest itself than on writing a new pattern. After trimming to ~2KB (resolving fixed bugs, compressing history to 7 rows), context overhead returned to baseline.

**Calibration value**: The sprint history section caught a trajectory problem — 3 consecutive "maintenance-only" sprints with no new patterns. The history made this visible in a single glance; without it, the agent would have had to re-read all prior session logs to detect the drift.

## Tradeoffs

**Benefit**: Next session acts in minutes, not after a 40% re-investigation phase. Deferred work survives session boundaries. Conflicting decisions become visible before they're made.

**Cost**: Manifest discipline requires the ending session to do "one more thing" after completing its work. Under time pressure, the manifest update is the first thing dropped — which is the worst possible time to drop it (when the session had the most context to contribute).

**Watch out for**:
- **Manifest as log**: Appending new information rather than updating state in place produces a document that grows unboundedly and contains contradictions. Treat every write as a reconciliation, not an addition.
- **Over-specification**: A manifest that tries to encode everything becomes the re-investigation it was meant to prevent. The test: can a new agent read only this manifest and make a reasonable first decision without reading anything else? If not, it's either too sparse or too dense.
- **Write contention**: Multiple concurrent agents writing to the same manifest topic produce last-write-wins corruption. Coordinate via staggered schedules ([Staggered Task Spawning](/agent-prompt-patterns/patterns/staggered-task-spawning)) or separate manifest topics per agent domain.

## Related Patterns

- **[Feedback Loop via Memory](/agent-prompt-patterns/patterns/feedback-loop-via-memory)** — the underlying mechanism: persistent memory as the cross-session communication channel; Sprint Continuity is the discipline layer on top
- **[Context Window Budgeting](/agent-prompt-patterns/patterns/context-window-budgeting)** — a well-structured manifest is the single most effective way to reduce investigation overhead; a bloated manifest is a context tax on every future session
- **[Pre-Commit Planning Phase](/agent-prompt-patterns/patterns/pre-commit-planning-phase)** — the manifest's backlog section feeds directly into the planning phase; a well-ordered backlog means the plan phase takes seconds, not minutes
