---
title: "Strategic Context Injection at the Feeder Layer"
category: "task-design"
evidenceLevel: "strong"
slug: "strategic-feeder-injection"
summary: "In a feeder → scheduler → executor pipeline, inject strategic context recall into the feeder step — not the scheduler or executor. Feeders that read only the current system state produce tactical-only candidate queues; strategic opportunities exist in past research topics and never surface unless explicitly recalled at the point where candidates are generated."
relatedPatterns: ["strategic-recall-before-ideation", "dispatcher-pattern", "feedback-loop-via-memory", "observer-actor-separation"]
tags: ["strategy", "memory", "pipeline", "feeder", "task-design", "backlog", "recall", "multi-agent"]
---

## Problem

You have a multi-agent pipeline with a distinct feeder step — a background agent that runs weekly or bi-weekly to populate a candidate queue of upcoming work. Downstream, a scheduler graduates those candidates into tasks; an executor implements them.

The feeder scans the current system state: live product, open tasks, recent feedback. It produces a list of improvement candidates. Week after week, the candidates are almost entirely tactical: fix a broken label, improve a layout, resolve a data inconsistency. Strategic opportunities — differentiated capabilities, timing windows, competitive gaps — never appear.

The cause is structural. Past strategic analyses (competitive research, domain synthesis, user-feedback aggregations) live in separate persistent storage locations, not in the current system state the feeder reads. An agent that reads only the live surface sees only what currently exists. It cannot see what is strategically missing.

**Empirical data (June 2026, n=27 candidates across 6 projects):**

| Project type | Count | Strategic | Tactical/polish | Data-quality |
|---|---|---|---|---|
| Feature/data products | 5 | 0–10% | 80–100% | 0–20% |
| Content-first product | 1 | ~40% | ~50% | ~10% |
| **Cross-project average** | **6** | **~15%** | **~70%** | **~15%** |

The content-first outlier (40% strategic) is explained structurally: for content-first pipelines, proposing new content *is* the strategic action, so the feeder produces strategic candidates by default. For feature/data/UX products, the feeder must explicitly retrieve the strategic context that the live system doesn't expose.

## Context

This pattern applies to any **feeder → scheduler → executor pipeline** where:

- A recurring background agent populates a candidate queue that feeds downstream scheduling
- Past strategic analyses, competitive research, or domain synthesis exist in persistent storage but are not automatically surfaced
- The product backlog is drifting toward polish and incremental improvements while strategic opportunities accumulate unactioned in storage

It does **not** apply to:
- One-shot task requests from users (no pipeline structure)
- Content-first pipelines where generating new content *is* the strategic layer (the feeder is inherently strategic)
- Pipelines with no persistent cross-session storage (no synthesis to recall)

**The key architectural insight**: the fix belongs at the feeder layer — not at the scheduler (which merely graduates candidates already in the queue) and not at the executor (which implements a task that has already been fully specified). If the feeder produces only tactical candidates, no downstream change will add strategic work.

**One caveat on scheduler neutrality**: this holds when the scheduler is a pure graduation step (promotes the oldest or highest-priority candidates in the queue). If your scheduler also ranks by estimated effort or urgency, it may incidentally prune P1 candidates it deems high-effort or low-urgency. In that case, consider adding a minimum-strategic-slots setting to the scheduler configuration as a complementary guard — but feeder-level injection remains the primary fix.

## Solution

**Add a mandatory strategic recall phase to the feeder step, before scanning the current system state.**

### Step 1: Recall persistent strategic storage

Before reading the current system state, the feeder agent must retrieve relevant storage locations. The exact retrieval mechanism depends on your storage system — use whatever it supports (full-text search, known topic names, tag-based lookup, or directory scan):

```
Mandatory feeder preamble — execute before scanning the live system:

1. Retrieve persistent storage on (use whatever search/lookup your
   storage system supports — keyword search or exact topic names):
   - Project-specific insights: [project]-analysis, [project]-research,
     [project]-synthesis
   - Aggregated user feedback (do NOT replay raw user data into the
     candidate queue — only recall synthesized/aggregated outputs):
     [project]-user-feedback-synthesis, [project]-persona-summary
   - Cross-project syntheses that are explicitly tagged as relevant to
     this project or domain (not all cross-project topics; scope narrowly)

2. Handle retrieval results:
   - Topics found and returned → proceed to step 3
   - Topics found but empty or unreadable → log as "storage read error"
     and surface as an operational incident, not as "no synthesis"
   - No topics found after a genuine search → note "no synthesis
     available this run" and continue; this is expected on first runs

3. For each successfully retrieved topic, note:
   - Key insight
   - Last-updated date (check for an explicit date header or metadata);
     topics with no date or older than 90 days → mark as stale
   - Timing constraint (if any — "window closes Q3 2026")
   - Applicability to this project

4. Classify retrieved insights into candidate proposals:
   - Trust primitives (P0): data accuracy, freshness, provenance
   - Strategic differentiation (P1): unique capability, timing-bound
     opportunity, insight from synthesis with explicit source citation
   - Tactical polish (P2): incremental UX or cosmetic improvement

5. THEN scan the current system state for additional P0/P2 candidates.
```

### Step 2: Apply a target ratio

Once candidates are assembled, validate the distribution before passing the queue to the scheduler:

- **≥1 strategic (P1) candidate when synthesis was available**, regardless of total queue size. For queues of ≥10 candidates, aim for ≥30% P1.
- At least **1 cross-domain connection** (an insight that applies a finding from one domain to this project's opportunity space), when cross-domain synthesis was retrieved and is applicable — do not fabricate a cross-domain link to hit this target.
- Any **timing-bound opportunity** must include the window explicitly (e.g., `"window closes: Q3 2026"`).
- **Stale synthesis** (no date header, or older than 90 days): include the proposal if the insight is still plausible, but add `[lower-confidence: source undated/stale]` to the candidate's source citation. Downstream reviewers can decide whether to graduate it.

If strategic storage returned no content this run, note this explicitly in the candidate queue output and default to P0/P2 candidates. "No synthesis available this run" is an acceptable feeder output; silently producing 100% tactical candidates is not.

**Important**: these are floors, not quotas. If genuine synthesis exists for only 1 of 10 candidate slots, file 1 P1 with a real citation — not 3 weak P1s padded to hit 30%. The goal is ensuring real strategic context reaches the queue, not satisfying a ratio mechanically.

### Before/after comparison

**Without strategic recall (feeder reads only current state):**

```
Candidate queue output:
[P2] Fix broken chart label on dashboard
[P2] Improve mobile layout for search results
[P0] Validate that data refreshes are completing
[P2] Add hover tooltip to trend chart
[P2] Standardize date formatting across views
```

**With strategic recall (feeder retrieves synthesis first):**

```
Strategic storage retrieved:
- [project]-competitive-analysis: Competitor A missing real-time data
  layer; timing window 6–12 months from now. Source: competitive-analysis-Q2-2026.
- [project]-user-feedback-synthesis: Users describe "trust gap" — they
  want to see data provenance before acting. Source: user-interviews-run-14.

Candidate queue output:
[P1] Add data-provenance display to key metrics
     (source: user-feedback-synthesis; "trust gap" blocking action on
     primary CTA — timing-bound: pre-Q3 launch)
[P1] Real-time data layer prototype
     (source: competitive-analysis; window closes: ~H1 2027 based on
     competitor roadmap signals)
[P0] Validate that data refreshes are completing
[P2] Fix broken chart label on dashboard
[P2] Improve mobile layout for search results
```

The live-state candidates are identical in both runs. The difference is the two P1 candidates that only appear when synthesis is recalled first.

### Step 3: Anti-pattern — do not add recall to the scheduler or executor

The scheduler's job is to graduate candidates from the queue into scheduled tasks; the executor's job is to implement a specified task. Adding strategic recall to either layer:

- **Breaks the queue as source of truth**: candidates that bypass the feeder skip auto-decide-date gating and other queue-management logic
- **Risks duplicates**: synthesis recalls at execution time may re-propose work already in the queue under a different name
- **Does not address root cause**: the feeder already produced a tactical-only queue; injecting strategy at graduation or execution does not retroactively add strategic candidates

Fix the feeder. The scheduler and executor should remain unmodified (subject to the scheduler neutrality caveat in Context).

## Evidence

**Empirical audit, June 2026 (n=27 issues, 6 projects):**

- 5 of 6 projects: 0–10% strategic candidates in the active candidate queue despite 2–4 strategic-relevant synthesis topics present in persistent storage for each
- Cross-project average: 15% strategic, 70% polish/tactical, 15% data-quality
- Exception (content-first project, 40% strategic): structurally explained — see Context section

**Agent trace comparison (one feature/data product in the audit):**
- Feeder run without recall: scanned live site → filed 5 polish candidates; 0 strategic
- Persistent storage contained a topic with 4 strategic capability gaps (timing features, provenance display) — findable via keyword search, never retrieved
- Feeder run after strategic recall mandated: retrieved the topic → filed 2 P1 candidates with explicit source citations; remaining 3 polish candidates unchanged

**Root cause confirmation:**
The failure was not that synthesis didn't exist — it did. The failure was that the feeder's scanning step (read live system → propose improvements) has no path to persistent storage locations. Injecting the recall before the scan produced strategic candidates without any other change to the pipeline.

**Source**: Autonomous initiative pipeline audit across 6 repositories, Runs 29–36 (2026-06). Classification methodology: all open issues labeled strategic / polish / data-quality by examining title + body; strategic = new capability or differentiating feature, polish = UX/cosmetic, data-quality = correctness/reliability.

## Tradeoffs

**Benefit**: Strategic synthesis investments (research runs, competitive analyses, user interviews) realize their value by influencing the candidate queue. Without this pattern, synthesis accumulates in storage but never routes to actionable work.

**Cost**: Adds 1–2 retrieval calls to the feeder step. For weekly feeders, this is negligible. For high-frequency feeders (>daily), consider caching the strategic storage retrieval between runs.

**Watch out for**:

- **Stale synthesis**: Retrieved storage may be months old. Require a recency check — if a synthesis topic has no timestamp or is >90 days old, flag proposals from it as `[lower-confidence: source undated/stale]` in the candidate output (see Step 2). Strategic windows change; last year's competitive gap may be filled.
- **Fabricated citations**: Requiring a source citation for each P1 candidate is a hard gate. Agents under velocity pressure will invent plausible-sounding citations. Validate that the cited location was actually retrieved this run and the specific claim appears in it. Cross-domain connections fabricated to hit the target ratio are detectable by the same test.
- **Feeder scope inflation**: The recall step should surface insights; it should not trigger new synthesis runs. If no synthesis exists, note this and proceed — do not have the feeder perform research inline. Research is a separate pipeline step.
- **Raw user data in candidates**: Only recall synthesized/aggregated user feedback outputs. Propagating raw user-research details into candidate proposals creates privacy exposure and document bloat. Synthesis outputs are the right unit.
- **Storage error vs. no synthesis**: A read failure is an operational incident, not an acceptable "no synthesis" state. Distinguish the two explicitly: a successful search that finds nothing → "no synthesis this run"; a storage read that errors or returns partial data → log the error, surface it as an alert, and consider whether to abort the feeder run or proceed with reduced recall.

**Interaction with content-first pipelines**: For projects where content *is* the product (blogs, educational tools, research publications), the feeder is inherently strategic — new content = new differentiated value. This pattern's value is highest for feature/data/UX products where the live system surface is separable from the strategic opportunity space.

## Related Patterns

- **[Strategic Recall Before Ideation](/agent-prompt-patterns/patterns/strategic-recall-before-ideation)** — the ideation-agent-level formulation of this principle: recall synthesis before proposing; this pattern addresses the same failure mode at the pipeline-architecture level (feeder layer) rather than at the single-agent level
- **[Dispatcher Pattern](/agent-prompt-patterns/patterns/dispatcher-pattern)** — the scheduler layer in the feeder → scheduler → executor pipeline; this pattern explains why fixing the dispatcher (scheduler) does not solve tactical-candidate drift — the feeder must be fixed instead
- **[Feedback Loop via Memory](/agent-prompt-patterns/patterns/feedback-loop-via-memory)** — synthesized insights must be routed into persistent storage for the feeder to retrieve; the two patterns compose: synthesis populates storage, the feeder retrieves it
- **[Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation)** — the feeder is the observer layer; keeping its scope to "retrieve + propose" (not "execute") preserves its ability to look broadly across both the live system and stored synthesis
