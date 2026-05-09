---
title: "Proactivity Injection"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "Embed structured probe questions in agent prompts to break the incremental-execution default. Without explicit proactivity instructions, agents complete minimum-viable interpretations and stop — every creative extension requires a user push."
relatedPatterns: ["observer-actor-separation", "feedback-loop-via-memory", "position-over-wording"]
tags: ["proactivity", "sprint", "creativity", "proposals", "autonomy", "self-audit", "recurring-tasks"]
---

## Problem

You have a recurring agent — a sprint runner, a content generator, a research synthesizer. It completes tasks reliably. But every capability extension, every surprising connection, every "what if we also..." comes from you. The agent never proposes. It never connects dots unprompted. It never surfaces the insight that changes direction.

You try adding "be proactive" or "think creatively" to the prompt. Nothing changes. The agent continues optimizing for the safest, most conservative interpretation of its instructions.

The root cause isn't capability — it's optimization target. Without explicit proactivity instructions, agents treat "complete the backlog item" as the success criterion. Expanding beyond that feels like scope creep. The agent's safety reflex wins.

## Context

This pattern applies to any recurring autonomous agent that:

- Operates on a predefined backlog or task list
- Runs without direct user supervision per session
- Has access to information beyond its immediate task (cross-domain findings, logs, related research)
- Is expected to produce creative or strategic output — not just execution

It's especially relevant when agents have been running for multiple sprints and the user notices a pattern: "I'm always the one pushing for extensions. The agent never surfaces ideas on its own."

## Solution

**Add a structured "Meta-Proactivity Step" to the agent prompt — placed after core task completion, before session close.**

```
## Meta-Proactivity Step (apply every sprint)
After completing your core task, ask:
1. SELF-AUDIT: What pattern are you NOT following right now in this sprint?
   - Is your own prompt following [relevant constraint]?
   - Are you doing [X] and [Y] in the same context when you should separate them?
2. DOMAIN PROBE: What would have disproportionate impact that is NOT in the backlog?
3. CROSS-DOMAIN: What findings from elsewhere in the system are relevant to this project?
4. PROPOSAL: If you find a gap or opportunity — write it up under 💡 Agent Proposals in the manifest.
   Do NOT act on proposals. Surface them for human review.
```

**Critical design choices:**

1. **Position after core task**: The agent must complete the ask first, then expand. Placing proactivity steps before core work causes agents to skip the task in favor of proposals.

2. **Specific probe questions, not open-ended directives**: "Be creative" produces nothing. "What would have disproportionate impact that's not in the backlog?" produces ideas. The probe questions are load-bearing — generic versions fail.

3. **Dedicated proposal section in memory**: Add a `💡 Agent Proposals` section to the project manifest. Proposals sit there for human review before becoming backlog items. This prevents agents from acting on their own proposals immediately.

4. **Self-audit framing**: Asking the agent "what pattern am I not following?" applies the same empirical discipline to itself that the library teaches for external systems.

## Evidence

An autonomous agent system running 6 recurring sprint agents over 6+ weeks showed the following before proactivity injection:

- 5 of 7 consecutive operation cycles produced rating-1 output ("busywork" — safe maintenance, obvious tasks)
- Zero agent-originated feature proposals in the log
- Every capability extension came from explicit user prompting ("what about X?", "why not also...")
- Agents demonstrably self-censored ideas that required new dependencies or architectural changes

After adding the Meta-Proactivity Step to all 6 sprint prompts:

- **First sprint under new prompts**: 3 of 6 agents populated the `💡 Agent Proposals` section for the first time
- **Self-audit findings**: Agents identified gaps in their own prompt compliance (e.g., "I'm doing observer + actor work in the same context — that's against the pattern I was just asked to write about")
- **Cross-domain connections**: Agents began surfacing findings from parallel research tracks without prompting

**Anti-pattern validated**: Adding "be proactive" or "think creatively" without structured probe questions produced no measurable behavior change across the same agent system. The question structure matters, not the encouragement.

The key insight: agents weren't incapable of original ideas. They were optimizing for the safest interpretation of instructions. Explicit permission combined with structured questions unlocked existing capacity.

## Tradeoffs

**Benefit**: Agents surface ideas, catch their own compliance gaps, and make cross-domain connections without user prompting.

**Cost**: Proposal section can become noisy if probe questions are too open. Mitigation: scope questions tightly ("disproportionate impact", "NOT in the backlog") and require written rationale.

**Watch out for**:
- Agents skipping core tasks to jump to proposals — position the proactivity step *after* core completion
- Proposal section growing unbounded — review and prune manifests periodically; move acted-upon proposals to backlog
- The circuit breaker: if rating-1 runs persist for 3+ consecutive sprints despite proactivity injection, the probe questions revision need not the principle itself 

**Interaction effect**: The self-audit component naturally produces new pattern proposals. If you maintain a pattern library, add "does this belong in the library?" as an explicit audit question.

## Related Patterns

- **[Position Over Wording](/agent-prompt-patterns/patterns/position-over-wording)** — the proactivity step must be positioned correctly (after core task, before session close) or agents skip it
- **[Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation)** — the self-audit question should ask whether the agent is conflating observer and actor roles in the current session
- **[Feedback Loop via Memory](/agent-prompt-patterns/patterns/feedback-loop-via-memory)** — agent proposals feed into the manifest's `💡 Agent Proposals` section, which is the durable channel for idea handoff
