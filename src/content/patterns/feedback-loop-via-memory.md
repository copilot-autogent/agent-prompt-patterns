---
title: "Feedback Loop via Memory"
category: "feedback-loops"
evidenceLevel: "strong"
summary: "Give recurring agents a manifest in persistent memory with an explicit feedback section. Agents check it at the start of every sprint and prioritize feedback over backlog. Without this, agents operate in backlog-tunnel-vision mode indefinitely."
relatedPatterns: ["position-over-wording", "observer-actor-separation"]
tags: ["memory", "feedback", "sprint", "manifest", "recurring-tasks", "product-ownership"]
---

## Problem

You have a recurring agent — a sprint runner, a weekly researcher, a content generator. It runs autonomously and produces real work. But it operates entirely on its own backlog. It optimizes for _completing backlog items_ rather than _delivering value_.

You notice issues: the agent is building features nobody asked for, or missing the one thing that actually matters this week. You try leaving feedback in a chat message. The agent sees it in the current session but forgets it by next sprint. The feedback loop is broken.

The root cause: agents have no durable channel to receive direction between sessions.

## Context

This pattern applies to any **recurring autonomous agent** that:
- Runs on a schedule (daily, weekly, biweekly)
- Maintains a backlog of work items
- Operates without direct user supervision per run
- Produces outputs that a human reviews (site content, reports, code)

The pattern is also useful for **multi-agent systems** where one agent observes and another acts — the manifest is the durable handoff between roles.

## Solution

**Create a project manifest in persistent memory with an explicit feedback section. Make checking it the mandatory first step.**

The manifest structure:
```markdown
# [Project] Manifest

## Identity
[Project description, repo URL, site URL]

## Published / Completed
[What has been shipped — ground truth for the agent]

## Backlog
[Items to work on, in priority order]

## Sprint Protocol
[How the agent should run — what to recall, what to check]

## 🔴 User/Customer Feedback
[Feedback written by the user between sprints]
[Agent must prioritize this over backlog]
[Clear each item once addressed]

## 💡 Agent Proposals
[Agent's own ideas surfaced for user review]
[Not acted on until moved to backlog]
```

**In the sprint prompt (mandatory first block):**
```
MANDATORY FIRST STEP:
1. recall_memory("[project]-manifest") — check 🔴 Feedback section first
2. If feedback exists, prioritize it over everything else in the backlog
3. Once addressed, clear the feedback item from the manifest
```

**To leave feedback between sprints**, the user writes directly into the manifest's `🔴` section. The next sprint agent reads it as its first action.

**The manifest is the single source of truth** for the project's state. Sprint agents update it at the end of each run (completed items, new backlog items, proposals). This creates a durable state that survives session boundaries.

## Evidence

Applied across 3 autonomous side projects (content site, monitoring tool, data application):

**Before (no manifest)**:
- Agents ran 5+ sprints without user feedback reaching them
- Agents built increasingly elaborate features with no validation
- User identified a priority gap ("this project has zero external output") — took 2 weeks to surface to the relevant sprint agent
- Wrapper Monitor sprint ran 4 sprints building internal experiments while the stated goal (external-facing output) went unaddressed

**After (manifest with 🔴 section)**:
- User feedback written to manifest → sprint agent reads it in the mandatory first step → acted on in the same sprint
- Sprint 6 of a data visualization project: user wrote "add chart for X" to feedback section on Tuesday → Friday sprint shipped it
- Agent proposals surfaced for review before being acted on (eliminated several wasted sprints on low-value features)

The pattern also exposed a secondary benefit: manifests provide a **state recovery mechanism**. When a session crashes or context is lost, the agent can recall the manifest and resume without needing conversation history.

## Tradeoffs

**Benefit**: Bidirectional communication between user and autonomous agent across session boundaries.

**Cost**: Manifest becomes a single point of failure — if it gets corrupted or over-written, the agent loses its state. Mitigation: use `recall_memory` before `save_memory` (read-before-write discipline). Memory systems with conflict detection (checking modification timestamps) provide additional protection.

**Watch out for**:
- Manifest growing unbounded — completed items should be moved to a "recent" section and eventually pruned, not accumulated
- Agent clearing feedback before acting on it — enforce "act first, then clear"
- Feedback section being ignored because it's at the bottom of the manifest → use Position Over Wording to front-load the feedback check

**Interaction effect**: Combine with **Observer-Actor Separation** for multi-agent projects — the Observer writes to the manifest, the Actor reads it. The manifest becomes the structured handoff document between roles.

## Related Patterns

- **[Position Over Wording](/agent-prompt-patterns/patterns/position-over-wording)** — the feedback-check directive must be in the mandatory first block, not buried at the end
- **[Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation)** — the manifest is the durable handoff medium between observer and actor agents
