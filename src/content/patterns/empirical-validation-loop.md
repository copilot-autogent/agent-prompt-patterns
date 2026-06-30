---
title: "Empirical Validation Loop"
category: "feedback-loops"
evidenceLevel: "strong"
summary: "Agents and their prompts are software — they should be tested like software. A/B test prompt variants across real agent runs, measure outcome differences with concrete metrics, and graduate findings into pattern evidence. Without this loop, prompt design is guesswork that accumulates tech debt in the form of untested assumptions."
relatedPatterns: ["proactivity-injection", "prompt-diversity-over-model-diversity", "sprint-continuity", "observer-actor-separation", "deploy-lag-verification", "convergence-stall-detection"]
tags: ["experimentation", "a-b-testing", "measurement", "prompt-design", "evidence", "iteration", "validation"]
---

## Problem

A team improves an agent's prompt based on intuition — adding emphasis ("IMPORTANT"), reordering sections, appending new instructions. The agent seems to behave better. The team ships the change.

Three months later, nobody knows which part of the prompt is doing what. When the agent misbehaves, nobody can point to why. When a new requirement comes in, the team adds more text and hopes. The prompt has become legacy code: nobody dares touch it, nobody understands it, and it probably has bugs nobody has found yet.

This is prompt debt. It accumulates when changes are made without measurement.

## Context

This pattern applies whenever:
- A prompt is being written or significantly modified
- An agent behavior is inconsistent and you want to understand why
- You want to justify a prompt design decision with evidence rather than intuition
- Multiple agents run the same task type and produce varying quality outputs
- A prompt has been modified several times and its effective elements are unclear

The pattern requires that agents produce outputs that can be compared — either by observable behavior (did the agent call the right tool?), artifact quality (did the output meet the spec?), or a self-reported metric the agent provides consistently (self-rated output quality score).

## Solution

Structure prompt experimentation as a small, disciplined A/B study:

**1. Fix a single hypothesis.** State what you believe a change will affect and how: "Adding mandatory instructions before the content (Position Over Wording) will increase correct tool-call rate from ~33% to >80%." One hypothesis per experiment — multi-change experiments produce uninterpretable results.

**2. Design exactly two (or a small fixed set of) variants.** A control (current prompt) and a treatment (single modification). Resist the urge to test "improved overall prompt" — every change beyond the hypothesis variable becomes a confound.

**3. Run N≥3 trials per variant on real tasks.** Synthetic or simulated runs miss failure modes that only appear in production context (rate limits, live API responses, tool call sequencing under real load). The minimum bar for a "conclusion" is 3 trials per variant with consistent direction.

**4. Measure an observable outcome, not a subjective one.** Good metrics: tool call made (yes/no), correct output format (yes/no), task completion rate, self-rated score on a defined rubric. Poor metrics: "felt better," "seemed more helpful," qualitative impression.

**5. Graduate the finding into a reusable pattern.** A finding that lives only in a dev's notes is invisible to the next person who touches the prompt. The moment a hypothesis is confirmed across ≥3 trials, it becomes a pattern candidate: problem, context, solution, evidence table, tradeoffs. This library is the repository for those graduates.

## Evidence

**Experiment 9 — Proactivity variants across 6 agents (6-week study):**

Six side-project sprint agents each received a different proactivity prompt modification (variants 9a–9f). Outcomes were measured by self-rated novelty score (1=busywork, 2=useful, 3=genuinely novel) across runs in weeks 1 and 2.

| Variant | Modification | Week 2 Status | Avg Rating |
|---------|-------------|---------------|------------|
| 9a | "Propose 1 post not on the backlog" | STRONG | 3.0 |
| 9b | First-time-visitor user persona | STRONG | 2.7 |
| 9c | Discoverability self-audit | MODERATE | 2.3 |
| 9d | Data-driven initiative trigger | STRONG | 3.0 |
| 9e | Target-user persona (30-second task) | STRONG | 3.0 |
| 9f | Novel pattern proposal prompt | STRONG | 3.0 |

By week 2, all 6 variants were producing novel proposals (5/6 STRONG). The study identified that persona framing (9b, 9e) produced the highest-fidelity matches between prompt intent and agent output — the agent's proposed change directly mirrored the persona's described frustration. This finding became the Persona Empathy Probe backlog item.

Critically: this would not have been discoverable without comparing variants across runs. A single improved sprint producing one novel idea would look like noise.

**Experiment 11 — Lens diversity vs model diversity (18-run controlled study):**

Phase 1 baseline: 13 models, identical prompt → 1 novel concept produced.
Phase 2 treatment: 3 models × 6 persona lenses → 11 novel concepts produced.

The study used a consistent novelty metric (concepts not present in Phase 1 output) that could be measured without subjective judgment. The 7.5× improvement in novel-concept yield per run was observable and reproducible across lens types. This directly falsified the prior assumption that model diversity was the primary driver of output quality — it was prompt framing diversity.

Both experiments followed the same structure: fixed hypothesis, controlled variants, observable metric, graduated finding.

## Tradeoffs

**Cost of running experiments:** Real-agent trials consume tokens, time, and sometimes money. A 3×2 experiment at 30s/run costs 3 minutes plus overhead. The break-even point is approximately 1 hour of debugging time saved — which is typically reached on the first production incident that could have been caught by a 6-trial experiment.

**Self-rated metrics are gameable:** When agents rate their own outputs, high scores are easier to produce by outputting confidently than by producing genuinely novel work. Calibrate self-rating rubrics with explicit examples of each score level. Use external validators (human review, downstream task success rate) when the stakes are high.

**Small N limits confidence:** 3 trials per variant is the minimum bar for a directional signal, not a statistically rigorous result. Conclusions from N=3 should be labeled "directional" and revisited if the pattern becomes load-bearing. N≥6 per variant is the threshold for strong-evidence designation in this library.

**Variant discipline erodes over time:** After a study concludes, the temptation is to improve the winning variant before the next study begins. This resets the baseline silently. Each new study should explicitly document what the current control prompt contains and commit it to version control before variants are tested.
