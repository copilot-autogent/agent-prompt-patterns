---
title: "Strategic Context Injection at the Feeder Layer"
category: "task-design"
evidenceLevel: "strong"
summary: "In a feeder → scheduler → executor pipeline, inject strategic context recall into the feeder step — not the scheduler or executor. Feeders that read only the current system state produce tactical-only candidate queues; strategic opportunities exist in past research topics and never surface unless explicitly recalled at the point where candidates are generated."
relatedPatterns: ["strategic-recall-before-ideation", "dispatcher-pattern", "feedback-loop-via-memory", "observer-actor-separation"]
tags: ["strategy", "memory", "pipeline", "feeder", "task-design", "backlog", "recall", "multi-agent"]
---

## Problem

You have a multi-agent pipeline with a distinct feeder step — a background agent that runs weekly or bi-weekly to populate a candidate queue of upcoming work. Downstream, a scheduler graduates those candidates into tasks; an executor implements them.

The feeder scans the current system state: live product, open tasks, recent feedback. It produces a list of improvement candidates. Week after week, the candidates are almost entirely tactical: fix a broken label, improve a layout, resolve a data inconsistency. Strategic opportunities — differentiated capabilities, timing windows, competitive gaps — never appear.

The cause is structural. Past strategic analyses (competitive research, domain synthesis, user-feedback aggregations) live in separate persistent storage topics, not in the current system state the feeder reads. An agent that reads only the live surface sees only what currently exists. It cannot see what is strategically missing.

**Empirical data (June 2026, n=27 candidates across 6 projects):**

| Project type | Strategic candidates | Tactical/polish candidates |
|---|---|---|
| Feature/data products (4 projects) | 0–10% | 80–100% |
| Content-first product (1 project) | ~40% | ~50% |
| Cross-project average | ~15% | ~70% |

The content-first project outlier (40% strategic) is explained structurally: for content-first pipelines, proposing new content *is* the strategic action, so the feeder produces strategic candidates by default. For feature/data/UX products, the feeder must explicitly retrieve the strategic context that the live system doesn't expose.

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

## Solution

**Add a mandatory strategic recall phase to the feeder step, before scanning the current system state.**

### Step 1: Recall persistent strategic storage

Before reading the current system state, the feeder agent must retrieve relevant storage topics:

```
Mandatory feeder preamble — execute before scanning the live system:

1. Retrieve persistent storage on:
   - Project-specific insights: [project]-analysis, [project]-research, [project]-synthesis
   - Domain or market insights: [domain]-competitive, [domain]-opportunity
   - Cross-domain syntheses from recent runs: initiative-run-* (last 4 weeks)
   - User feedback aggregations: user-feedback-*, persona-research-*

2. For each retrieved topic, note:
   - Key insight
   - Timing constraint (if any — "window closes Q3", "competitor ships Q2")
   - Applicability to this project

3. Classify retrieved insights into candidate proposals (before opening the live system):
   - Trust primitives (P0): data accuracy, freshness, provenance
   - Strategic differentiation (P1): unique capability, timing-bound opportunity
   - Tactical polish (P2): incremental UX or cosmetic improvement

4. THEN scan the current system state for additional P0/P2 candidates.
```

### Step 2: Apply a target ratio

Once candidates are assembled, validate the distribution before passing the queue to the scheduler:

- **≥30% strategic (P1)** candidates, each with an explicit source citation from step 1
- At least **1 cross-domain connection** (an insight that applies a finding from one domain to this project's opportunity space)
- Any **timing-bound opportunity** must include the window explicitly (`"window closes: Q3 2026"`)

If strategic storage is unavailable or returns no content, note this explicitly in the candidate queue output and default to P0/P2 candidates. "No synthesis available this run" is an acceptable feeder output; silently producing 100% tactical candidates is not.

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
- domain-competitive-analysis: Competitor A missing real-time data layer;
  timing window 6–12 months. Source: competitive-analysis-Q2-2026.
- user-feedback-synthesis-2026: Users describe "trust gap" — they want
  to see data provenance before acting. Source: user-interviews-run-14.

Candidate queue output:
[P1] Add data-provenance display to key metrics (source: user-feedback-synthesis-2026;
     "trust gap" is blocking action on primary CTA — timing-bound: pre-Q3 launch)
[P1] Real-time data layer prototype (source: domain-competitive-analysis;
     window closes: Q1 2027 — competitor roadmap visible)
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

Fix the feeder. The scheduler and executor should remain unmodified.

## Evidence

**Empirical audit, June 2026 (n=27 issues, 6 projects):**

- 4 of 6 projects: 0% strategic candidates in the active candidate queue despite 2–4 strategic-relevant synthesis topics present in persistent storage for each
- Cross-project average: 15% strategic, 70% polish/tactical, 15% data-quality
- Exception (content-first project, 40% strategic): structurally explained — see Context section

**Agent trace comparison (realestate-radar project):**
- Feeder run without recall: scanned live site → filed 5 polish candidates; 0 strategic
- Persistent storage contained a topic with 4 strategic capability gaps (timing features, provenance display) — findable via keyword search, never retrieved
- Feeder run after strategic recall mandated: retrieved the topic → filed 2 P1 candidates with explicit source citations; remaining 3 polish candidates unchanged

**Root cause confirmation:**
The failure was not that synthesis didn't exist — it did. The failure was that the feeder's scanning step (read live system → propose improvements) has no path to persistent storage topics. Injecting the recall before the scan produced strategic candidates without any other change to the pipeline.

**Source**: Autonomous initiative pipeline audit across 6 repositories, Runs 29–36 (2026-06). Classification methodology: all open issues labeled strategic / polish / data-quality by examining title + body; strategic = new capability or differentiating feature, polish = UX/cosmetic, data-quality = correctness/reliability.

## Tradeoffs

**Benefit**: Strategic synthesis investments (research runs, competitive analyses, user interviews) realize their value by influencing the candidate queue. Without this pattern, synthesis accumulates in storage but never routes to actionable work.

**Cost**: Adds 1–2 retrieval calls to the feeder step. For weekly feeders, this is negligible. For high-frequency feeders (>daily), consider caching the strategic storage retrieval between runs.

**Watch out for**:

- **Stale synthesis**: Retrieved storage topics may be months old. Require a recency check — if a synthesis topic has no timestamp or is >90 days old, flag proposals from it as lower-confidence. Strategic windows change; last year's competitive gap may be filled.
- **Fabricated citations**: Requiring a source citation for each P1 candidate is a hard gate, not a soft goal. Agents under velocity pressure will invent plausible-sounding citations. Validate that the cited topic was actually retrieved this run and the claim appears in it.
- **Feeder scope inflation**: The recall step should surface insights; it should not trigger new synthesis runs. If no synthesis exists, note this and proceed — do not have the feeder perform research inline. Research is a separate pipeline step.

**Interaction with content-first pipelines**: For projects where content *is* the product (blogs, educational tools, research publications), the feeder is inherently strategic — new content = new differentiated value. This pattern's value is highest for feature/data/UX products where the live system surface is separable from the strategic opportunity space.

## Related Patterns

- **[Strategic Recall Before Ideation](/agent-prompt-patterns/patterns/strategic-recall-before-ideation)** — the ideation-agent-level formulation of this principle: recall synthesis before proposing; this pattern addresses the same failure mode at the pipeline-architecture level (feeder layer) rather than at the single-agent level
- **[Dispatcher Pattern](/agent-prompt-patterns/patterns/dispatcher-pattern)** — the scheduler layer in the feeder → scheduler → executor pipeline; this pattern explains why fixing the dispatcher (scheduler) does not solve tactical-candidate drift — the feeder must be fixed instead
- **[Feedback Loop via Memory](/agent-prompt-patterns/patterns/feedback-loop-via-memory)** — synthesized insights must be routed into persistent storage for the feeder to retrieve; the two patterns compose: synthesis populates storage, the feeder retrieves it
- **[Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation)** — the feeder is the observer layer; keeping its scope to "retrieve + propose" (not "execute") preserves its ability to look broadly across both the live system and stored synthesis
