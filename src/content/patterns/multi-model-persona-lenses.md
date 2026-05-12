---
title: "Multi-Model Persona Lenses"
category: "multi-agent"
evidenceLevel: "strong"
summary: "Run review agents with distinct adversarial persona prompts rather than running the same neutral prompt across multiple models. Prompt diversity outperforms model diversity: persona-constrained agents find 7.5× more novel issues per run than unprompted agents using different models."
relatedPatterns: ["dispatcher-pattern", "observer-actor-separation", "bounded-autonomy"]
tags: ["code-review", "multi-agent", "multi-model", "adversarial", "personas", "review", "diversity", "prompt-design"]
---

## Problem

You want thorough automated code review before merging a PR. You run the same review prompt on three different models. The models converge. All three flag the same two obvious issues. The subtle race condition, the missing boundary check, the implicit trust assumption — none of them surface.

You try adding emphasis: "look for SECURITY issues", "be THOROUGH". Same results.

The problem isn't model diversity. It's prompt diversity.

When multiple agents receive the same neutral prompt, they anchor on the same framing — regardless of which model is running. The dominant interpretation of "review this code" is "find obvious bugs." Every agent converges on it. The issues that require a different starting assumption go unfound.

## Context

This pattern applies when you are:

- Running parallel automated code review (pre-merge, security audits, reliability checks)
- Brainstorming ideas or proposals with multiple agents
- Evaluating designs or architectures where different risk profiles matter
- Any multi-agent workflow where you want to maximize coverage rather than confidence on a single interpretation

The pattern is especially valuable when the defects you care about most are **non-obvious**: protocol gaps that only matter at scale, attack vectors that require an adversarial starting assumption, operational failure modes that require imagining a 3am outage.

## Solution

**Assign each review agent a distinct adversarial persona, not a different model.**

Instead of: "Review this code for bugs" × 3 models

Use a lens matrix:

```
Agent 1 — Precision lens (unprompted baseline):
  Review the code. Report only issues that genuinely matter.

Agent 2 — Adversary lens:
  You are reviewing for security completeness. Check for:
  - Missing authentication/authorization checks
  - Input validation gaps
  - Privilege escalation paths
  - Protocol coverage gaps (what can be sent that shouldn't be?)
  Do NOT just confirm what the code does right. Find what it leaves open.

Agent 3 — Risk lens:
  You are reviewing for operational failure modes. Check for:
  - What happens at 3am when this fails silently?
  - Race conditions under concurrent load
  - Data corruption under partial-failure scenarios
  - Missing idempotency guarantees
  Assume the system will fail. Find where.
```

**For compliance-sensitive changes**, add a fourth lens:

```
Agent 4 — Regulatory lens:
  Review for audit trail completeness, data retention requirements,
  and authorization documentation. What would fail a compliance review?
```

**Consolidation rule**: Triage findings by consensus.
- Found by 2+ agents independently: must-fix
- Found by 1 agent (lens-specific): evaluate with lens context; often still real
- Contradicted by other agents: flag for discussion

**Framing caution**: Adversarial framing ("attack these fixes") can trigger content filters on some models. Use neutral framing ("security completeness review") — the persona still works, the filter doesn't fire.

## Evidence

An autonomous agent system ran two experiments to measure prompt diversity vs. model diversity:

**Experiment A — Creative ideation:**
- Setup: 3 models × 6 lens prompts (18 runs) vs. 13 unprompted runs across different models
- Result: 11 novel concepts from the 18 lens runs vs. 1 from the 13 unprompted runs
- **7.5× more novel ideas per run** with persona lenses vs. model-only diversity

**Experiment B — Code review (10 planted bugs):**
- Setup: 3-agent unprompted review vs. 3-agent lens-based review (Precision + Adversary + Risk) on the same codebase
- Bug recall: both approaches found all 10/10 planted bugs — lens assignment doesn't hurt core recall
- "Beyond obvious" findings: **15 additional issues** found by lensed agents vs. **1 additional issue** from unprompted agents
- The adversary lens found protocol gaps and missing authorization checks not in the planted set
- The risk lens found race conditions and silent failure modes not visible from a neutral reading

**Secondary finding**: The Precision (unprompted) lens acts as a noise filter. When the same issue appears in the Precision run AND a specialized lens run, it's a high-confidence finding. Issues appearing only in specialized lenses still warrant review but require the lens context to evaluate.

**Anti-pattern confirmed**: Swapping models while keeping neutral prompts produced near-zero additional coverage. The same model with a different lens prompt consistently outperformed a different model with the same neutral prompt.

## Tradeoffs

**Benefit**: Significantly higher coverage on non-obvious issues. Each agent genuinely investigates a different hypothesis about what might be wrong.

**Cost**: 3–4 review runs instead of 1. Consolidation step required before acting on findings. Some lens-specific findings require judgment about whether the lens's threat model applies.

**Watch out for**:
- **Lens explosion**: more than 4–5 agents produces diminishing returns and consolidation overhead. Three lenses (Precision + Adversary + Risk) covers ~90% of the value.
- **Acting on individual lens findings without consolidation**: a single adversary-lens finding with no corroboration is a signal, not a verdict. Always check whether other lenses saw the same gap.
- **Content filter friction**: adversarial framing ("hack", "attack", "exploit") can trigger refusals on some models. Use function-first framing: "find authorization gaps" rather than "find ways to bypass authorization."
- **Same-family anchoring**: running 3 Claude models or 3 GPT models with the same lens still converges. Use models from different families when possible (one per behavioral cluster).

**Interaction with Dispatcher Pattern**: The dispatcher spawns lens-based agents as actors. Each lens agent gets the PR diff, the specific lens prompt, and a brief on what "must-fix" means. The dispatcher consolidates findings when all three complete.

## Related Patterns

- **[Dispatcher Pattern](/agent-prompt-patterns/patterns/dispatcher-pattern)** — dispatches lens agents as parallel actors, consolidates findings, surfaces must-fix items before merge
- **[Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation)** — each lens agent is a pure actor: it receives the diff and returns findings without re-reading the full codebase
- **[Bounded Autonomy](/agent-prompt-patterns/patterns/bounded-autonomy)** — lens findings with 2+ consensus become self-decidable fixes; single-lens findings surface to human review before acting
