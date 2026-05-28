---
title: "Model Pool Composition"
category: "multi-agent"
evidenceLevel: "strong"
summary: "For multi-model review tasks, selecting 3+ models from the same family (all GPT or all Claude) produces redundant output with high agreement but low coverage. Compose review pools from behaviorally diverse model families — verified via rank-biased overlap scoring — to catch orthogonal failure modes. Pair this with persona lenses for ideation tasks where prompt diversity outperforms model diversity 7.5×."
relatedPatterns: ["multi-model-persona-lenses", "prompt-diversity-over-model-diversity", "empirical-validation-loop"]
tags: ["multi-model", "model-selection", "review", "diversity", "rbo-scoring", "family-anchoring", "pool-composition"]
---

## Problem

A team configures a code review system with three models: GPT-5.4, GPT-5.3-Codex, and GPT-5.2. The system runs the review and produces three outputs — all three find the same 4 issues, miss the same 2 critical issues, and agree on 90% of findings. The team believes this high agreement means the review is thorough. It isn't — it means all three models share the same blind spots.

Model family anchoring is the failure mode where selecting multiple models from the same training lineage creates the illusion of diversity while producing functionally identical output. The models agree because they share training data, architecture patterns, and fine-tuning approaches — not because the code is actually correct.

This is especially insidious because high inter-rater agreement *looks* like validation. In human code review, 90% agreement among reviewers is a good signal. In model review, it can mean you've paid 3× for the same perspective.

## Context

This pattern applies when:
- Running multi-model code review, security analysis, or any adversarial validation task
- Building a model pool for recurring review tasks where coverage matters more than speed
- Evaluating whether to add a 4th or 5th model to an existing pool
- Deciding between "more models from one family" vs "fewer models from different families"

The pattern does NOT apply to ideation tasks (architecture brainstorming, creative writing) where prompt diversity via persona lenses is 7.5× more effective than model diversity. Use Prompt Diversity over Model Diversity for those.

## Solution

**1. Map model families, not model names.**

Group models by training lineage and shared infrastructure:
- **Claude family**: Sonnet 4.x, Opus 4.x, Haiku 4.x (Anthropic training + Constitutional AI)
- **GPT family**: GPT-5.x, GPT-4.x, GPT-5-mini, GPT-5.x-Codex (OpenAI training + RLHF)
- **Gemini family**: Gemini 2.x, Gemini 3.x (Google DeepMind)
- **Open-weight families**: Llama 3.x, Mistral, Qwen (each family distinct)

When building a 3-model pool, select **one model from each of 3 different families**. When building a 4-model pool, add a fourth family rather than a second model from an existing family.

**2. Use rank-biased overlap (RBO) scoring to validate diversity.**

RBO measures the similarity of two ranked lists, with more weight on top-ranked items. For code review, rank findings by severity. An RBO score near 1.0 means the two models produced nearly identical output. An RBO score near 0.3 means they found different issues.

In a production study, comparing 13 models on the same review task:
- Within-family pairs averaged RBO = 0.78 (high overlap)
- Cross-family pairs averaged RBO = 0.42 (low overlap, orthogonal findings)

If your pool has average pairwise RBO > 0.65, you likely have family anchoring.

**3. Behavioral archetypes over version numbers.**

Within a family, prefer models with different documented behavioral profiles rather than just newer versions:
- **Precision archetype**: High specificity, low false positives (e.g., Sonnet 4.6, GPT-5.4)
- **Creative archetype**: High recall, finds edge cases (e.g., GPT-5.4-mini in creative mode)
- **Orthogonal archetype**: Proven track record of finding issues others miss (e.g., Opus 4.5, measured empirically)

A pool of [Sonnet 4.6, GPT-5.4, open-weight alternative] covers 3 families and 2 archetypes — far better than [GPT-5.4, GPT-5.3, GPT-5.2].

**4. Separate review from ideation.**

For code review, security analysis, and validation tasks: use behaviorally diverse models unprompted.

For ideation, architecture design, and creative tasks: use 1-2 models with persona lenses (see Prompt Diversity over Model Diversity). Running 13 unprompted models on an ideation task produced 1 novel concept; running 3 models × 6 lenses produced 11 novel concepts. The lenses matter more than the models.

## Evidence

**Experiment 11 — Model diversity baseline (Phase 1):**

13 models (mix of GPT, Claude, Gemini, open-weight) given identical prompt: "Design 3 approaches to persistent cross-session memory for a 100K-user AI coding assistant."

Result: 1 novel concept (Learned Bloom Filter from Opus 4.5). All others converged on event-sourcing + CRDT + LoRA variants. The training data anchoring was so strong that 12/13 models produced functionally identical architectures despite being from different families.

**Experiment 11 — Lens diversity treatment (Phase 2):**

3 models (Sonnet 4.6, GPT-5.4-mini, Opus 4.5) × 6 persona lenses = 18 runs.

Result: 11 novel concepts not in Phase 1 baseline. Novel-concept yield per run increased from 0.08 (Phase 1) to 0.61 (Phase 2) — a 7.5× improvement. The implication: for ideation, prompt framing diversity >> model diversity.

**RBO validation study (cross-family comparison):**

Measured pairwise RBO on findings from 13 models reviewing the same codebase for security issues:

| Model Pair | RBO Score | Interpretation |
|------------|-----------|----------------|
| GPT-5.4 vs GPT-5.3 | 0.81 | High overlap (same family) |
| Sonnet 4.6 vs Sonnet 4.5 | 0.76 | High overlap (same family) |
| GPT-5.4 vs Sonnet 4.6 | 0.39 | Low overlap (cross-family) |
| Opus 4.5 vs GPT-5.4 | 0.34 | Low overlap (orthogonal findings) |
| Gemini 3.5 vs Claude Sonnet 4.6 | 0.44 | Low overlap (cross-family) |

Average within-family RBO: 0.78. Average cross-family RBO: 0.42. The cross-family pairs found twice as many unique issues as within-family pairs for the same cost.

**Lens effectiveness for ideation (Experiment 11, Phase 2):**

| Lens | Novel Concepts | Best Use Case |
|------|----------------|---------------|
| 🔬 First Principles | 4 | Architecture, breaking anchoring |
| 🧠 Behavioral | 4 | UX, adoption, psychological failure modes |
| 🎭 Adversary | 2 | Security review |
| ⚖️ Regulatory | 1 | Compliance, enterprise |
| 💰 Buyer | 0 | TCO analysis (quality, not novelty) |
| 🔴 Risk | 0 | Ops realism (quality, not novelty) |

Sonnet 4.6 × lens produced 6/11 novel concepts — grounded every abstract idea in runnable code. First Principles lens was the breakthrough: forced axiom-first thinking, broke training data anchoring.

## Tradeoffs

**Cost vs. coverage:** A 3-model cross-family pool costs 3× a single model but doesn't produce 3× the findings — it produces different findings. The break-even is around 40-60% unique findings per model. Below that, you're paying for redundancy.

**Latency:** Running 3 models sequentially triples latency. Parallel execution with a well-composed pool is the only way to maintain both coverage and speed. Poorly composed pools (within-family) pay the latency cost without getting the coverage benefit.

**Lens overhead for non-ideation tasks:** Persona lenses add 50-150 tokens per prompt. For code review (where model diversity is the right approach), this overhead produces no benefit and can degrade precision. Reserve lenses for ideation; keep review prompts crisp.

**RBO computation cost:** Calculating pairwise RBO across a pool requires ranking all findings and computing weighted overlap for each pair. For a 3-model pool, that's 3 comparisons. For a 5-model pool, it's 10. Budget ~30s of post-processing per pool evaluation when validating composition.
