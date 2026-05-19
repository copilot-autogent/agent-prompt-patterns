---
title: "Prompt Diversity over Model Diversity"
category: "multi-agent"
evidenceLevel: "strong"
summary: "When assembling a multi-model agent pool for ideation tasks, varying the system prompt (persona lens) per model produces 7.5× more novel output than running multiple models on the same prompt. Model families converge; reasoning frames diverge."
relatedPatterns: ["multi-model-persona-lenses", "dispatcher-pattern", "observer-actor-separation"]
tags: ["multi-agent", "ideation", "diversity", "model-pool", "persona", "brainstorming", "review", "lenses"]
---

## Problem

You have access to multiple AI models. You assume that running the same prompt across many models produces diverse output — each model trained differently, each with different strengths. You build a pool: 8 models, same prompt, aggregate results.

The output is disappointingly convergent. Every model proposes event-sourcing, CRDT, and LoRA variants. You get slight phrasing differences, not orthogonal ideas. More models produces more text, not more signal.

The failure mode isn't capability — it's training-data anchoring. Models trained on overlapping corpora produce overlapping outputs when given the same reasoning frame. Diversity of model does not imply diversity of thought.

## Context

This pattern applies to any multi-agent workflow where the goal is **generating novel options** rather than validating known ones:

- Architecture brainstorming across multiple design axes
- Threat modeling for a new system
- Identifying failure modes before launch
- Generating product ideas from constrained briefs
- Exploring approaches to a novel technical problem

It does **not** replace model diversity for **precision tasks** — code review, bug detection, factual verification. For those, model diversity still matters because different training produces different error distributions. Use this pattern for ideation; use model diversity for review.

## Solution

**Replace model diversity with lens diversity: assign a distinct reasoning frame (system prompt) to each agent in the pool, using 1–3 models.**

A lens is a short system-prompt prefix that forces a specific reasoning perspective before the agent sees the task:

```
🔬 First Principles lens:
"Ignore all existing solutions. Start from first principles —
 what does the system fundamentally need to do, and what's the
 minimum mechanism that achieves it? Treat any reference to
 existing patterns as a smell."

🧠 Behavioral lens:
"You study why people make irrational decisions under uncertainty.
 Evaluate this system through the lens of cognitive biases —
 what will users do wrong, what will they game, and what will
 cause silent failures in production?"

🎭 Adversary lens:
"You are trying to break this system. Your goal is to find the
 assumption that, when violated, causes the most catastrophic
 failure. Design against yourself."

🔴 Risk/Failure lens:
"You've seen 200 systems like this fail at scale. You know the
 failure signatures. Walk through operational failure modes before
 touching the design."

⚖️ Regulatory lens:
"You audit systems for compliance. Think in liability, audit
 trails, and what a regulator would demand after a breach."

💰 Buyer lens:
"You're the person paying for this. Think in TCO, exit costs,
 and what this system will look like to your successor in 3 years."
```

**Practical selection rules:**
- For ideation: use **First Principles** + **Behavioral** (together produce ~70% of novel concepts)
- For pre-launch review: add **Risk** + **Adversary** (quality improvement, not novelty)
- For enterprise/compliance contexts: add **Regulatory** + **Buyer**
- A pool of 2 lenses × 1 model outperforms 8 models × 0 lenses for novel concept generation

## Evidence

A controlled experiment compared two multi-model configurations on an identical architecture design task:

**Phase 1 — Model diversity baseline**: 13 models, same prompt, no persona lens.

Result: 1 novel concept emerged (a probabilistic data structure approach from a reasoning-heavy model). All other models converged on the same 3 architectural patterns — event sourcing, CRDTs, and LoRA fine-tuning variants. 12 of 13 models produced functionally identical recommendations in different phrasing.

**Phase 2 — Lens diversity experiment**: 3 models × 6 lenses = 18 total runs, same task.

Result: 11 novel concepts not present in the baseline. Quantified:

| Metric | 13 Models, no lens | 3 Models × 6 lenses |
|---|---|---|
| Novel concepts | 1 | 11 |
| Novel per run | 0.08 | 0.61 |
| Efficiency gain | baseline | **7.5×** |

**Lens effectiveness ranking** (by novel concepts generated):

| Rank | Lens | Novel Concepts | Best use |
|---|---|---|---|
| 1 | 🔬 First Principles | 4 | Architecture, ideation |
| 2 | 🧠 Behavioral | 4 | Product, UX, adoption |
| 3 | 🎭 Adversary | 2 | Security, hardening |
| 4 | ⚖️ Regulatory | 1 | Compliance, enterprise |
| 5 | 💰 Buyer | 0 (best TCO depth) | Procurement |
| 6 | 🔴 Risk | 0 (best ops realism) | Pre-launch |

**Model × lens interaction**: The highest-performing combination was a precision-focused model under First Principles and Behavioral lenses — producing 6 of the 11 novel concepts. The same model run without a lens produced the same convergent output as the others.

**Unexpected finding**: Behavioral lens uniquely produced *psychological failure modes* — named failure patterns (e.g., "perfect memory paradox: users game the system once they know its rules") that no amount of model diversity had surfaced. These are as valuable for product design as the architectural novelty.

## Tradeoffs

**Benefit**: 7.5× more novel concepts per run, with fewer models and lower total cost than large unprompted pools.

**Cost**: Lens selection requires upfront judgment — the wrong lens for the task produces low-signal output (e.g., using Adversary for product ideation). The lens is load-bearing; a poorly-written lens collapses back toward convergent output.

**Watch out for**:
- **Lens anchoring**: A strong lens can make a model refuse to consider any approach that doesn't fit the frame (e.g., First Principles rejecting all database solutions because "that's an existing pattern"). Mitigation: run one unprompted baseline alongside lens runs.
- **Precision vs. novelty tradeoff**: For code review and bug detection, lens diversity may hurt consistency. Keep model diversity for review pools; use lens diversity for ideation pools.
- **Lens drift over long sessions**: The system prompt lens is most effective in fresh sessions. Long-running sessions where the task context grows can dilute the lens effect. Use per-task sessions, not shared contexts, when applying lenses.

**Interaction effect**: This pattern works best with [Multi-Model Persona Lenses](/agent-prompt-patterns/patterns/multi-model-persona-lenses) — which defines the pool architecture — and [Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation) — ideation (lens-based) and implementation (precision-based) should run in separate contexts.

## Related Patterns

- **[Multi-Model Persona Lenses](/agent-prompt-patterns/patterns/multi-model-persona-lenses)** — the pool architecture this pattern improves; use lens diversity within the pool rather than model diversity alone
- **[Dispatcher Pattern](/agent-prompt-patterns/patterns/dispatcher-pattern)** — use the dispatcher to fan out lens-specific tasks and aggregate results; lenses are most effective when each runs in a clean, isolated context
- **[Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation)** — run ideation (lens pool) and implementation (single precision model) in separate contexts; don't mix frames
