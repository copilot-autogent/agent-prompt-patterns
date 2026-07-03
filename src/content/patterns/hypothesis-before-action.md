---
title: "Hypothesis-Before-Action"
category: "agent-autonomy"
evidenceLevel: "moderate"
summary: "Agents encountering unexpected behaviour often take multiple simultaneous fix actions without first forming an explicit model of why the failure occurs. This produces false fixes, confounded root causes, and abandoned hypotheses. Before any debugging action, state an explicit, falsifiable hypothesis, execute only the minimum action to test it, and update the hypothesis before acting again."
relatedPatterns: ["empirical-validation-loop", "constraint-falsification", "tool-error-triage", "evidence-freshness-decay"]
tags: ["debugging", "hypothesis", "falsification", "root-cause", "diagnosis", "scientific-method", "one-variable-at-a-time", "tier:2-standard"]
---

## Problem

When agents encounter unexpected behaviour or a failing test, they often take multiple simultaneous "fix" actions — patching code, changing config, updating dependencies, restarting services — without first forming an explicit model of *why* the failure occurs. This shotgun approach produces three failure modes:

1. **Masked bugs**: the issue appears fixed because a coincidental change hid it; the root cause remains latent.
2. **Confounded changes**: multiple simultaneous edits make root cause unidentifiable even after the fix.
3. **Abandoned hypotheses**: valid hypotheses are discarded without proper falsification because an unrelated change "worked."

The result is a system that fails again under slightly different conditions, with no record of why the original fix worked.

## Context

This pattern applies to any agent performing:

- **Debugging tasks** — failing tests, build errors, unexpected runtime behaviour
- **Data pipeline investigation** — missing or malformed output with unclear cause
- **Infrastructure diagnosis** — service outages, configuration drift, environment mismatches
- **Unexpected agent behaviour** — a sub-agent producing wrong output or no output

It is most valuable when a fast guess-and-try loop is *tempting* — the failure seems obvious and the fix seems small. Those are exactly the conditions where coincidental masking is most likely.

## Solution

### Protocol

Apply this six-step cycle for every debugging action:

```
1. OBSERVE    — record the failure precisely: error message, stack trace, inputs, outputs.
                Do not paraphrase. Capture the exact text, redacting any secrets or PII
                before recording or propagating the observation.

2. HYPOTHESIZE — state explicitly:
                "I believe the root cause is X, because Y. This predicts Z."
                Z must be an observable, falsifiable outcome.

3. MINIMISE   — identify the single smallest change or observation that would
                confirm or falsify Z. One variable only.

4. TEST       — execute only that change or observation. Nothing else.

5. EVALUATE   — did the result match prediction Z?
                YES → hypothesis confirmed; re-run the minimal reproducer to confirm
                      the fix holds in isolation, then run the full test suite.
                NO  → hypothesis falsified; record what you learned;
                      return to step 2 with the updated model.

6. DOCUMENT   — after resolution, record:
                • initial hypothesis
                • what falsified it (if applicable)
                • actual root cause
                • the confirming test
```

### Rules

**One variable per test**: never change two things between observations. If two changes are needed, make them in separate steps with a test run between each. Two simultaneous changes make it impossible to know which one caused the observed outcome.

**Falsification over confirmation**: prefer tests that would *disprove* your hypothesis over ones that would merely support it. A test that can only confirm is weak evidence; a test that would disprove but does not is strong evidence.

**State the prediction before running**: write the hypothesis and its prediction *before* executing the test, not after seeing the result. Post-hoc rationalisation ("I suspected that all along") is a major source of anchoring errors in debugging sessions.

**Hypothesis budget of 3 (heuristic)**: if three hypotheses have been falsified without yielding clear new evidence, treat that as a signal to re-read the original error message from scratch. This is a heuristic trigger for re-observation, not an unconditional stop — if each cycle is producing materially new information, continue past three. The goal is to break anchoring loops, not to cap genuine progress.

## Anti-patterns

**Shotgun fixing**: changing multiple things at once and calling it "fixed" when tests pass. This produces latent bugs, makes regressions harder to diagnose, and violates the one-variable rule.

**Predictionless trying**: executing a change without a stated prediction of what it would confirm or refute. "Let me try X and see what happens" is not a hypothesis — it produces data with no interpretive frame.

**Implicit falsification**: abandoning a hypothesis after a single failed attempt without explicitly logging it as falsified. If a hypothesis is not explicitly closed, it re-enters the candidate pool implicitly on the next failure, wasting future cycles.

**Post-hoc root cause**: declaring root cause after an ad-hoc change produced a passing test, without tracing *why* the change fixed the failure. Build success is not proof of root cause.

**Parallel fixes in a single commit**: bundling multiple speculative changes in one commit to "save time." This prevents bisection and makes the fix non-reproducible in isolation.

## Evidence

**CONTEXT.md "Debugging Approach"**: *"Write test scripts to verify hypotheses empirically before implementing fixes."* This directive, recorded from production sprint postmortems, encodes the same principle: test the hypothesis, don't act on it directly.

**`systematic-debugging` skill**: codifies a 4-phase diagnosis-first process (Observe → Hypothesize → Experiment → Fix). This pattern distills the core mental discipline — hypothesis-first — into a reusable reference applicable outside formal debugging sessions, including investigation tasks, data pipeline failures, and unexpected agent behaviour.

**Sprint failure-recovery sessions**: multiple sprint postmortems in the autogent system show that root-cause ambiguity was the primary blocker when debugging stalled. In the documented cases, the stall was caused by simultaneous changes (e.g., changing config + code + dependency at once) that masked the actual root cause. Explicit hypothesis tracking was introduced as a remediation in the `when-debugging` playbook section.

**Anchoring trap**: the `when-debugging` playbook section contains an explicit "empirical anchoring trap" warning — agents anchor on the first plausible hypothesis and do not falsify it. The hypothesis budget heuristic (re-observe after 3 falsified hypotheses without new evidence) was derived from observed debugging sessions where agents spent 6+ cycles on variations of the same incorrect initial hypothesis.

## Related Patterns

- **Empirical Validation Loop** — the outer run → observe → update loop; this pattern adds an explicit hypothesis layer *before* the run step, making the loop's purpose explicit and falsifiable.
- **Constraint Falsification** — applies the same falsification discipline to operational assumptions ("I assume X is true") rather than failure hypotheses. Complementary: Hypothesis-Before-Action for active failures; Constraint Falsification for latent assumptions.
- **Tool Error Triage** — classifies the error type first before acting. Feeds the OBSERVE step of this pattern: a correctly classified error produces a better-formed hypothesis.
- **Evidence Freshness Decay** — stale observations produce stale hypotheses. Before cycling back to HYPOTHESIZE, verify that the evidence from OBSERVE still reflects current system state, especially after any environmental change.
