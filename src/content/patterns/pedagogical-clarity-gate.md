---
title: "Accuracy vs Pedagogical Clarity Gate"
category: "feedback-loops"
evidenceLevel: "moderate"
summary: "When agents generate explanatory content, accuracy review and clarity review must be separate gates. A factually correct explanation can still be useless for learning. Add a pedagogical clarity reviewer after content generation that explicitly asks: 'Would the target audience understand this, or merely read it?'"
relatedPatterns: ["empirical-validation-loop", "multi-model-persona-lenses", "observer-actor-separation"]
tags: ["explanation-quality", "pedagogy", "content-generation", "review-gates", "audience", "clarity", "feedback-loops", "educational-ai"]
---

## Problem

When agents generate explanatory content — tutorials, code documentation, pattern descriptions, step-by-step guides — the standard quality gate checks **factual accuracy**: Is this correct? Is it grounded in data? Does it hallucinate?

Factual accuracy is necessary but not sufficient for learning. An explanation can be 100% accurate and completely useless for understanding. This failure mode is **silent**: unit tests pass, multi-model review says "looks good," and the user reads the explanation and learns nothing.

A 2026-06-12 dogfood session on shogi-srs (n=10 puzzles, 1-kyu player) surfaced this gap directly: AI explanations were grounded in engine analysis (2.7/3 factual accuracy), but the user reported "mostly don't know what it means; some look irrelevant; don't know what makes the best move different; wording is not common." The multi-model code review did not catch any of these weaknesses because factual accuracy was fine.

**Five orthogonal weaknesses in AI-generated explanatory content:**

- **W1 – Register mismatch:** Prose defaults to formal/technical register regardless of audience expertise. An explanation written for a beginner reads like an encyclopedia entry.
- **W2 – Category label mismatch:** The agent assigns a taxonomy category that fits surface features but doesn't fit the specific instance pedagogically. The label is technically defensible but doesn't help the reader build the right mental model.
- **W3 – Missing "why the alternative fails":** States THAT alternatives are worse without showing HOW they fail. The reader knows the answer but not the reasoning.
- **W4 – Simulation burden:** Requires the reader to mentally simulate a complex process rather than providing visual affordances or progressive scaffolding. The explanation is technically complete but cognitively overloaded.
- **W5 – Meta-pedagogy gap:** Assumes the reader already knows the framework or terminology being used. First mentions of key concepts have no orienting definition.

These weaknesses are independent: fixing W1 does not fix W3. And they are invisible to accuracy reviewers, because each weakness produces a *correct* explanation that *fails to teach*.

## Context

This pattern applies to any agent workflow that generates explanatory content for human learners:

- Tutorial generation (coding patterns, how-to guides, onboarding docs)
- Code explanation and documentation agents
- Educational app content (flashcards, puzzle explanations, exercise feedback)
- AI-annotated reports intended for non-specialist readers (factor analysis summaries, subsidy eligibility explanations, market commentary)

**NOT applicable to:** Pure information retrieval (factual Q&A where correctness is the metric), code generation (the compiler is the clarity gate), or data transformation (no human reader).

The pattern is most valuable when: (1) the target audience has a specific expertise level different from the model's default register, (2) the content involves choices among alternatives, and (3) the content uses specialized terminology.

## Solution

**Add a pedagogical clarity review step, separate from accuracy review, after content generation.**

### 1. Separate accuracy checking from clarity checking

Run these as two distinct review passes with different prompts and different criteria. Conflating them causes accuracy to crowd out clarity — reviewers declare "this looks correct" and move on.

| Gate | Question |
|------|----------|
| Accuracy gate | Is this factually correct? Is it grounded in data? Does it hallucinate? |
| Clarity gate | Would a reader at the target expertise level *understand* this, or merely read it? |

### 2. Specify audience and register in the generation prompt

"Explain to [persona] in [register]" — not just "explain X." Unspecified register defaults to formal/encyclopedic, which is almost never the right register for a learner.

```
BAD:  "Explain why 7六歩 is the best move here."
GOOD: "Explain to a 10-kyu shogi player, in plain conversational language, why 7六歩 is the best move here.
       Assume they understand piece movement but not strategic concepts."
```

This directly addresses W1 and W5 with zero additional pipeline cost.

### 3. Prompt for counterfactual contrast

When comparing alternatives, require the agent to show the failure path, not just name the winner:

```
After stating the recommended move, walk through what happens if the player chose [alternative] instead.
Show 2-3 concrete steps demonstrating why that choice leads to a worse position.
```

This addresses W3. Note: it may require additional context data (continuation lines, evaluation scores) — plan the data pipeline accordingly.

### 4. Add a pedagogical clarity reviewer agent

After content generation, run a second-pass reviewer with a prompt focused on clarity:

```
You are reviewing this explanation for pedagogical clarity, NOT factual accuracy.
Target audience: [persona and expertise level]
Rate this explanation 1-3:
  1 = The reader would be confused or lost
  2 = The reader would follow the words but not deeply understand
  3 = The reader would genuinely understand and be able to apply this
Briefly explain your rating and identify the specific weakest element (W1 through W5 if applicable).
```

Filter out ratings below 2 and return the content to the generation step with the reviewer's diagnosis.

### 5. Sequence fixes by effort

| Weakness | Fix effort | Approach |
|----------|------------|----------|
| W1 Register mismatch | Low (prompt-only) | Add persona + register specification to generation prompt |
| W5 Meta-pedagogy gap | Low (prompt-only) | Add "include one-line concept explainers for first mentions of specialized terms" |
| W2 Category label mismatch | Medium (post-hoc pass) | Add validation pass: "Does this label fit this specific instance for a [target audience]?" |
| W4 Simulation burden | Medium (UI or prompt) | Add scaffolding affordances in UI, or prompt for step-by-step breakdown |
| W3 Missing counterfactual | High (data pipeline) | May require additional continuation data in the pipeline |

Start with W1 and W5 — they cost one additional prompt sentence each and directly address the most common failure modes.

## Evidence

**Shogi-srs dogfood session (2026-06-12, n=10 puzzles, 1-kyu player):**
- AI-generated puzzle explanations grounded in engine analysis (factual accuracy 2.7/3)
- User feedback: "mostly don't know what it means; some look irrelevant; don't know what makes the best move different; wording is not common"
- Post-hoc analysis confirmed all five weaknesses (W1–W5) present in the same session
- Multi-model code review did not flag any of the weaknesses — the explanations were factually accurate

**Cross-domain confirmation (Agent Prompt Patterns site):**
- W1 (academic tone in pattern summaries) and W5 (assumes reader knows CoT/ReAct terminology) confirmed present in this site's own content — not shogi-specific weaknesses

**Evidence level: moderate.** The five-weakness taxonomy (W1–W5) is derived from one structured dogfood session and corroborated by cross-domain observation. The pedagogical clarity reviewer step has not yet been run at scale with measured outcome improvement. The pattern is promoted from `emerging` to `moderate` because the failure mode is structurally distinct from accuracy failures and the fix mechanisms are tractable.

## Tradeoffs

**Benefit:** Catches an entire class of content failure that accuracy review misses by design. The clarity gate is the only signal that distinguishes "the model stated a correct fact" from "the learner understood the concept."

**Cost:** An additional review pass per generated explanation — roughly one additional LLM call. For high-volume pipelines, this adds latency and cost. Mitigation: apply only to explanations that will be surfaced to users, not intermediate generation steps.

**Watch out for:**
- **Clarity reviewer anchoring on accuracy:** Prompt carefully — reviewers default to "this is correct" as a proxy for "this is good." Explicitly exclude accuracy from the clarity review criteria.
- **Register specification over-constraining tone:** "Plain language" prompts can produce dumbed-down explanations for more advanced learners. Calibrate the persona carefully.
- **W3 counterfactual inflating explanation length:** Set a length budget ("2-3 concrete steps") or the counterfactual walkthrough can dominate the explanation.
- **W2 category validation becoming a semantic debate:** Keep the post-hoc validation question grounded in the reader's perspective ("would a [target audience] place this in category X?"), not the agent's taxonomic logic.

## Related Patterns

- **[Empirical Validation Loop](/agent-prompt-patterns/patterns/empirical-validation-loop)** — use A/B testing to measure whether the clarity gate actually improves reader comprehension scores before deploying at scale
- **[Multi-Model Persona Lenses](/agent-prompt-patterns/patterns/multi-model-persona-lenses)** — the pedagogical clarity reviewer is a persona-based second pass; multi-model composition increases the probability that at least one lens notices a register mismatch
- **[Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation)** — the generator and the clarity reviewer are naturally distinct roles; keep them in separate agent passes to prevent the generator from anchoring the reviewer
