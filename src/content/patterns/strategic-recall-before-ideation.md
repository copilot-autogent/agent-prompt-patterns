---
title: "Strategic Recall Before Ideation"
category: "feedback-loops"
evidenceLevel: "moderate"
summary: "Before proposing improvements, ideation agents must recall synthesis memory first. Agents that scan the live system state without recalling domain research produce disproportionately tactical (polish/UX) proposals and miss the strategic opportunities hidden in synthesis topics."
relatedPatterns: ["feedback-loop-via-memory", "observe-resolve-pairing", "proactivity-injection"]
tags: ["memory", "ideation", "strategy", "backlog", "recall", "synthesis", "feedback-loops"]
---

## Problem

You have a recurring ideation agent — a weekly product ideation task, a feature proposal workflow, a backlog grooming agent. It scans the live system state, reads the manifest, and proposes improvements.

The proposals are almost always tactical: fix a broken UI element, improve a label, resolve a data inconsistency. The backlog fills with polish and UX work. Strategic opportunities — new differentiating capabilities, insights from research synthesis — never appear.

**Cross-project audit (2026-06-17):** Across 6 active side projects, 27 open issues were classified:
- **15% Strategic** (new differentiating capabilities)
- **70% Polish** (UX/cosmetic improvements)
- **15% Data Quality** (foundational correctness)

4 of 6 projects had 0% strategic proposals in their ideation queue.

The root cause is not that strategic opportunities don't exist — they exist in synthesis memory. The root cause is that the ideation agent never recalls them. It sees the surface (what's broken, what looks rough) and proposes fixes for the surface. It doesn't see the research on competitive differentiation, the domain synthesis on missing capabilities, the user feedback synthesis on what users actually want.

**Confirmed by agent trace comparison:** A realestate-ideation agent scanned the live site and filed 5 polish issues. An existing synthesis memory topic listed 4 strategic timing features. No recall of the synthesis topic → 0 strategic proposals.

**Exception:** A content-first project (ai-security-blog) had 40% strategic proposals — because the "content" IS the product, so the agent naturally reasons about strategic direction rather than UX chrome.

## Context

This pattern applies to **recurring ideation agents** for living products or projects:
- Weekly/bi-weekly product ideation tasks
- Feature proposal workflows
- Backlog grooming agents

Particularly important when:
- Research synthesis topics exist but aren't automatically surfaced
- The system state looks "good enough" but strategic differentiation opportunities are hidden in memory
- The product backlog is dominated by polish/incremental work and stakeholders are wondering why nothing feels like a step-change

## Solution

**Mandate synthesis memory recall as the first step of any ideation task, before scanning the live system.**

**The four-step ideation sequence:**

1. **Recall synthesis memory first.** Before scanning the current state, retrieve relevant research synthesis topics: prior competitive analysis, domain research, user feedback synthesis. Use `recall_memory("[project]-*")` or specific topic names known to contain synthesis.

2. **Classify proposals by type.** Distinguish:
   - **Strategic**: new capability, differentiating value, fills a gap surfaced by synthesis
   - **Polish**: incremental UX improvement, cosmetic fix
   - **Data Quality**: foundational correctness, reliability

   Aim for ≥30% strategic proposals per ideation run.

3. **Route synthesis findings to backlog first.** When a synthesis topic implies a missing capability, file a proposal — even if the live site doesn't obviously show the gap. The live system reflects past decisions, not future opportunities.

4. **Then scan the current state.** Polish and data quality proposals are still valuable. They should come AFTER strategic scanning, not instead of it.

**In the ideation task prompt:**
```
MANDATORY FIRST STEP (before scanning the live site):
1. recall_memory("[project]-manifest") — read the synthesis and research sections
2. recall_memory any other synthesis topics known for this project (competitive analysis, user research, domain synthesis)
3. List the strategic opportunities visible in synthesis memory
4. File at least one strategic proposal per synthesis topic that implies a capability gap
5. THEN scan the live site for polish/data quality improvements
6. Tag each proposal: [strategic] / [polish] / [data-quality]
7. Verify: at least 30% of proposals are tagged [strategic]
```

**Synthesis topic discovery** (when topic names aren't known):
```
recall_memory("[project] synthesis") → scan results for research summaries
recall_memory("[project] analysis") → competitive or domain analysis
recall_memory("[project] user feedback") → user need synthesis
```

## Evidence

**Cross-project audit, Run 35 (2026-06-17):**
- Examined all open issues across 6 projects
- 4 of 6 projects: 0% strategic proposals in ideation queue
- Identified 3+ strategic opportunities per project that existed in synthesis memory but were never routed to backlog
- ai-security-blog exception (40% strategic): content-first ideation bypasses this failure mode naturally

**Root cause confirmed:**
Compared agent trace for realestate-ideation (scanned site → filed 5 polish issues) vs existing synthesis topic that listed 4 strategic timing features. No recall of synthesis → 0 strategic proposals. The synthesis topic was present and findable; it was simply not recalled.

**Source data:** `ideation-task-quality-audit-june-2026` memory; `autonomous-initiative-run-35-june-17` memory.

**Predicted effect of fix:**
- Ratio should shift from 15:70:15 → ~30:55:15 (strategic:polish:data-quality)
- 3+ strategic proposals per project per ideation run (vs. 0 without recall)

## Tradeoffs

**Benefit**: Synthesis memory captures the insight that took research time to produce. Surfacing it into the backlog realizes that investment. Without this pattern, research stays in memory indefinitely without influencing product direction.

**Cost**: Adds a recall step that takes 1–2 model calls at the start of each ideation run. Small cost relative to the value of strategic proposals.

**Watch out for**:
- **Recall of stale synthesis:** If synthesis memory hasn't been updated since a major pivot, recalling it will surface outdated opportunities. Add a timestamp check: "if this synthesis is >60 days old, flag as potentially stale before proposing."
- **Flooding the backlog with unvalidated strategic proposals:** Require that each strategic proposal include a 2-sentence rationale connecting the synthesis finding to a concrete user value or competitive advantage. This filters out noise.
- **Ignoring the 30% floor in fast runs:** When the task prompt is under velocity pressure, the synthesis recall step tends to be skipped first. Treat the 30% floor as a hard gate, not a soft goal.

**Interaction with content-first products:** For products where content IS the differentiation (blogs, research publications, educational tools), ideation agents naturally produce strategic proposals because the "content topic" IS the capability. This pattern is most critical for products with UX/feature surface that can be polished indefinitely.

## Related Patterns

- **[Feedback Loop via Memory](/agent-prompt-patterns/patterns/feedback-loop-via-memory)** — the manifest that ideation agents read should include a synthesis section alongside the backlog; the two patterns compose
- **[Observe-Resolve Pairing](/agent-prompt-patterns/patterns/observe-resolve-pairing)** — ideation (observe) should be paired with a dispatcher that routes strategic proposals through a higher-scrutiny review path than polish items
- **[Proactivity Injection](/agent-prompt-patterns/patterns/proactivity-injection)** — when synthesis memory surfaces a strategic opportunity, the ideation agent should propose it proactively, not wait for the user to ask
