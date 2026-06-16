---
title: "First-Principles Constraint Lens"
category: "multi-agent"
evidenceLevel: "strong"
summary: "Inject a system-prompt constraint that explicitly prohibits existing frameworks and forces axiom-first reasoning. In controlled experiments, this single lens produced 4 of 11 novel concepts (36%) across 18 lens runs — the highest-yield individual lens in the experiment."
relatedPatterns: ["prompt-diversity-over-model-diversity", "multi-model-persona-lenses"]
tags: ["multi-agent", "ideation", "first-principles", "brainstorming", "architecture", "anchoring", "lenses", "prompt-design", "reasoning"]
---

## Problem

When you ask an AI agent to brainstorm architecture options or propose designs, it anchors on its training distribution — the most common solutions in the literature.

In a 13-model baseline experiment (no persona lens), all 13 models converged on event-sourcing, CRDT, and LoRA variants for a memory architecture problem. Only 1 novel concept emerged across all 13 runs.

**Root cause**: Without a frame-breaking constraint, agents default to retrieving popular patterns, not reasoning from first principles. The "pull" toward training-data-common solutions is invisible to the agent — it presents familiar approaches as if they were derived conclusions.

This failure is silent. The agent confidently describes event sourcing as if it had reasoned its way to it. You can't tell the difference between "I derived this from constraints" and "I recalled this from training data" without an explicit probe.

## Context

This pattern applies when you are:

- Brainstorming architecture options for a problem with existing, well-known solutions
- Generating design proposals in a domain where frameworks already exist
- Breaking out of an apparent "no good solution" deadlock (often a signal that all explored options are training-data recalls, not reasoned derivations)
- Any ideation task where you suspect the agent is anchoring on the training distribution

**Do not apply this lens when:**
- The correct answer IS the conventional solution — don't force novelty for its own sake
- The task is implementation: "use this library correctly" is not a first-principles problem
- The task is review or audit: you want the agent to know existing standards and apply them

## Solution

**Inject a "First Principles" constraint lens that explicitly prohibits existing solutions and forces axiom-first reasoning.**

```
You are a first-principles reasoner.
Ignore all existing frameworks, libraries, and conventional approaches.
Start from the fundamental constraints of the problem:
- What does the system actually need to do? (not how it's currently done)
- What physical/logical limits exist? (not what current tooling supports)
- What would you build if nothing existed yet?

Do NOT propose an existing tool or framework by name unless you have
independently derived that it is the correct solution from first principles.
```

**How to apply the constraint:**

1. **State the problem in terms of requirements, not solutions.** "We need durable, ordered, queryable event storage" rather than "we need an event store."

2. **Force derivation before naming.** Instruct the agent to describe the mechanism it is deriving before attaching a name. This reveals whether the name was the starting point (recall) or the conclusion (derivation).

3. **Run it alongside a precision baseline.** One unprompted baseline + first-principles lens is the minimum viable lens pool for ideation. The baseline catches obvious solutions the lens might reject; the first-principles run surfaces what the baseline never reaches.

**Extended version for architecture tasks:**

```
You are a first-principles reasoner for distributed systems.

Constraints you must derive from:
- The CAP theorem is a physical constraint, not a framework preference
- Network partitions will occur; assume they do
- Clocks are not synchronized; treat time as relative
- Storage is not free; model access patterns explicitly

Do not name any database, queue, or framework until you have described
the data access pattern it would serve. If you find yourself writing
"use Kafka", stop and write "the system needs X, because Y constraint
forces Z access pattern — a log-structured append store satisfies this"
instead.
```

## Evidence

**Experiment 11** (Prompt Lab, 2026-05-10) — 3 models × 6 reasoning lenses vs. 13 models × no lens, identical architecture design task:

| Metric | 13 Unprompted Models | 3 Models × 6 Lenses |
|--------|---------------------|---------------------|
| Novel concepts | 1 | 11 |
| Novel per run | 0.08 | 0.61 |
| **Improvement** | baseline | **7.5× more efficient** |

**First Principles lens specifically produced 4 of the 11 novel concepts (36%):**

- **Executable Predicate Graphs** — compiler-first memory design: WASM → AST compilation applied to agent memory predicates (claude-sonnet-4.6)
- **Epistemic Belief Lattice** — Truth Maintenance System applied to agent knowledge management; staleness modeled as belief retraction, not cache invalidation (claude-sonnet-4.6)
- **Neuromorphic Consolidation** — bio-inspired memory architecture; consolidation triggered by inactivity cycles, not explicit writes (claude-opus-4.5)
- **Physical Constraint Derivation** — storage hierarchy designed directly from access latency ratios rather than from existing tiered-cache patterns

**Lens effectiveness ranking** (by novel concepts generated in Experiment 11):

| Rank | Lens | Novel Concepts | Best For |
|------|------|----------------|----------|
| 1 | 🔬 **First Principles** | 4 | Ideation, architecture (breaks anchoring) |
| 2 | 🧠 **Behavioral/Psychological** | 4 | Product decisions, UX failure modes |
| 3 | 🎭 **Adversary** | 2 | Security review |
| 4 | ⚖️ **Regulatory** | 1 | Compliance analysis |
| 5 | 💰 **Buyer** | 0 (best TCO depth) | Procurement |
| 6 | 🔴 **Risk** | 0 (best ops realism) | Pre-launch review |

**Why it works**: The explicit prohibition on existing tools removes the "pull" toward training-data-common solutions. Agents must derive from constraints, not recall from pattern libraries. The mechanism is asymmetric: it takes approximately the same effort for the agent to name a framework as to derive one from scratch — but the constraint flips the output from retrieval to synthesis.

## Tradeoffs

**Benefit**: Highest-yield individual lens for novel concept generation. Particularly effective on architecture and design problems with mature existing solutions (exactly the problems where unprompted agents anchor hardest).

**Cost**: The lens can reject obviously correct conventional solutions. A first-principles agent may spend effort "deriving" PostgreSQL when PostgreSQL is clearly right. Mitigation: always run with an unprompted baseline.

**Watch out for:**

- **Derivation theater**: The agent describes a mechanism in first-principles language but names a known tool at the end anyway ("therefore: use Redis"). Check whether the conclusion is actually derived or just renamed. If the constraint produces "I derived we need a hash table with TTL, which I will call a cache", the lens is working. If it produces "therefore Redis", the frame broke before the conclusion.

- **Over-constraint paralysis**: On some tasks, the prohibition on existing tools produces refusal-adjacent behavior ("I cannot propose a solution without reference to existing tools"). Soften by allowing tools to be named *after* derivation: "You may reference an existing tool only after you have independently derived that its mechanism is correct for the constraints stated."

- **Novelty without value**: The First Principles lens maximizes novelty, not correctness. Derived architectures need separate evaluation for feasibility, implementability, and operational cost. Do not act on first-principles output without a precision-lens or risk-lens pass.

- **Lens anchoring in long sessions**: The constraint is most effective in fresh sessions. As task context grows, the lens effect weakens. Assign the first-principles run its own isolated session context.

## Related Patterns

- **[Prompt Diversity over Model Diversity](/agent-prompt-patterns/patterns/prompt-diversity-over-model-diversity)** — the parent pattern establishing that lens diversity outperforms model diversity 7.5×; First Principles is the empirically highest-yield specific lens
- **[Multi-Model Persona Lenses](/agent-prompt-patterns/patterns/multi-model-persona-lenses)** — defines the full lens pool architecture; use this pattern to select the First Principles lens within that pool
