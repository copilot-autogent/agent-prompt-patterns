---
title: "Enumeration-First Verification"
category: "task-design"
evidenceLevel: "moderate"
summary: "When an agent claims 'all N items satisfy property P', it typically supports this with a manual trace. Traces reliably miss defects because confidence compounds without actually testing the universal quantifier. For any batch claim, write an enumeration validator that checks every item programmatically — enumerate both input-legality invariants and output-correctness invariants."
relatedPatterns: ["empirical-validation-loop", "side-effect-verification", "pre-commit-planning-phase"]
tags: ["verification", "batch-validation", "invariants", "quality", "datasets", "enumeration", "testing", "silent-failure"]
---

## Problem

An agent generates a batch of N items and claims they all satisfy some property P. To support this claim, it traces through each item individually — "I checked puzzle #1: unique mate ✓, puzzle #2: unique mate ✓, ..., puzzle #10: unique mate ✓" — and concludes confidently that the batch passes.

This pattern fails silently and consistently. The trace-based approach has three structural weaknesses:

**Confirmation bias compounds**: Each individual check is done *expecting* to find the property. The agent is not searching for violations; it is confirming an assumption. High-confidence traces of incorrect items are indistinguishable from high-confidence traces of correct items in the agent's reasoning.

**The universal quantifier is never tested**: Confirming "each individual item seems fine" is not the same as testing "ALL items satisfy P." The difference only becomes apparent when an item doesn't satisfy P and the check misses it — which is exactly what traces do.

**Adversarial review inherits the same failure mode**: A second agent reviewing the first agent's trace will often perform its own trace using the same method. Since both are performing sequential per-item checks with the same confirmation bias, the second review is unlikely to catch what the first missed.

**Shogi-srs Sprint 2 incident (2026-05-28):** A 10-puzzle bank was claimed to have unique mating moves per puzzle after manual trace. A second adversary review (Claude Sonnet) also traced each puzzle and concluded "all correct" with high confidence. A brute-force enumeration validator was then written to enumerate all legal moves and count which ones delivered checkmate. It found **6/10 puzzles had alternative mating moves** — directly contradicting both traces. The bank was redesigned. Without the enumerator, 6 broken puzzles would have shipped silently as training data.

## Context

This pattern applies whenever an agent produces a batch of items and makes a universal claim about that batch:

- **Seed datasets**: "All training examples have exactly one correct answer"
- **Schema validation**: "All API responses match the declared schema"
- **Property audits**: "Every pattern file has the required frontmatter fields"
- **License/provenance audits**: "Every imported module has an approved license"
- **Content banks**: "Every puzzle/question/exercise satisfies the quality invariant"
- **Pipeline outputs**: "All generated records have no null required fields"
- **Any "all X are Y" invariant** that will be assumed downstream

The pattern is especially important when:
1. The property P is a *structural invariant* (can be programmatically checked)
2. The output will be used as input to another system or agent
3. The batch has more than ~5 items (beyond this, trace reliability degrades significantly)
4. A violation would be costly to discover after the fact

## Solution

**For any "all N items satisfy property P" claim, write an enumeration validator. Do NOT rely on manual trace.**

The core rule: replace "I checked each item and it looks right" with code that checks every item and asserts the property.

```typescript
// BAD: trace — "I checked each puzzle: #1 OK, #2 OK, ..., #10 OK."

// GOOD: enumerate
for (const p of bank) {
  const matingMoves = allLegalMoves(p.position)
    .filter(m => isCheckmate(applyMove(p.position, m)));
  assert.equal(matingMoves.length, 1,
    `${p.id}: expected unique mate, got ${matingMoves.length}`);
}
```

### Two invariant types to enumerate

Every enumeration validator should check both invariant types, not just one:

**Input-legality invariants** — properties the inputs must satisfy, independent of any output:
```typescript
// Does every input item satisfy the structural precondition?
for (const item of inputs) {
  assert(isValid(item), `${item.id}: precondition failed — item is structurally invalid`);
}
```

**Output-correctness invariants** — properties relating each output to its input:
```typescript
// Does every output correctly correspond to its input?
// Assert cardinality first — zip() silently drops excess items if lengths differ
assert.equal(inputs.length, outputs.length,
  `cardinality mismatch: ${inputs.length} inputs vs ${outputs.length} outputs`);
for (const [input, output] of zip(inputs, outputs)) {
  assert(isCorrect(input, output), `${input.id}: output does not satisfy invariant`);
}
```

Checking only output-correctness invariants misses entire bug classes where the input itself is structurally illegal. Both must be enumerated.

### The violation-first mindset

The key cognitive shift: instead of confirming "does this item satisfy P?", ask "what items in this batch violate P?" Build the validator to find violations, not to confirm presence:

```typescript
// VIOLATION-FIRST: collect all failures at once
const violations = bank.filter(p => matingMoveCount(p) !== 1);
assert.equal(violations.length, 0,
  `${violations.length} puzzles with non-unique mates: ${violations.map(p => p.id).join(', ')}`);
```

The violation-first formulation has a second advantage: it reports *which* items failed, not just *that* something failed.

### Prompt template for batch generation tasks

When tasking an agent to generate a batch and verify it, specify enumeration explicitly:

```
Generate [N items satisfying property P].

After generating, verify every item with an enumeration validator:
- Check input-legality: [specific structural precondition]
- Check output-correctness: [specific property P]
Do NOT verify by tracing — write code that checks all items and reports any violations.
If violations > 0, regenerate the failing items and re-verify the **entire batch** (not just the replaced items — batch-level invariants like uniqueness or coverage can be broken by any regeneration).
```

### Fail closed on parse anomalies

When an item in the batch cannot be parsed or interpreted, the safe default is to count it as a violation:

```typescript
function matingMoveCount(puzzle: Puzzle): number {
  try {
    return allLegalMoves(puzzle.position)
      .filter(m => isCheckmate(applyMove(puzzle.position, m))).length;
  } catch (e) {
    // Treat parse/runtime failures as violations (fail closed).
    // Note: if this catch fires unexpectedly, investigate the validator itself —
    // a broken checker hiding behind "violations" is worse than a trace.
    log.warn(`matingMoveCount: unexpected error for ${puzzle.id}`, e);
    return -1;
  }
}
```

Failing open on parse errors (treating them as "probably fine") is another source of silent defects.

## Evidence

**Shogi-srs Sprint 2 (2026-05-28) — single controlled experiment:**

| Method | Defects found | Defect rate |
|--------|--------------|-------------|
| Manual trace (agent 1) | 0 / 10 | 0% |
| Adversary trace (agent 2, Sonnet) | 0 / 10 | 0% |
| Brute-force enumeration validator | **6 / 10** | **60%** |

Both trace-based reviews concluded "all correct" with high confidence. The enumeration validator found 6 defective puzzles in the same bank. The property being tested (unique mating move per puzzle) was well-defined and programmatically checkable. The validator's implementation enumerated all legal moves from each position and filtered for checkmates — a direct, literal check of the invariant.

This is a single controlled experiment (one batch, one property type), which is why the evidence level is `moderate` rather than `strong`. The 60% defect-catch rate is striking but comes from a single run. The pattern has since been generalized and applied to other batch types (API schema validation, frontmatter property checks) without a second controlled experiment with trace-baseline comparison.

**Generalization evidence (observational):**

The autogent codebase applies enumeration-first verification in several production contexts:
- Pattern file frontmatter validation: every `.md` file in `src/content/patterns/` is validated against the Zod schema in `src/content/config.ts` at build time (Astro content collections). The build fails if any file violates a required field — a whole-collection invariant check, not a per-file trace.
- Sprint batch validation: when sprint agents generate sets of SQL todo records, the invariant "all required fields are non-null" is verified by querying `SELECT * FROM todos WHERE id IS NULL OR title IS NULL` rather than mentally tracing through the insert statements.

## Tradeoffs

**The cost of writing the validator**: A brute-force validator takes time to write — especially when the property requires domain knowledge (e.g., "enumerate all legal chess moves" requires a move generator). The break-even point is approximately 1 trace-based missed defect downstream. For datasets used as training data, as seed content, or as inputs to other agents, that break-even is almost always crossed.

**Properties that can't be enumerated**: Semantic quality (is this puzzle *interesting*?), style, subjective fitness-for-purpose. Enumeration-first verification applies to *structural invariants*, not subjective ones. Use sampling + human review for the latter.

**Single-item outputs**: Enumeration overhead is not worth it for a single item. The pattern applies when N ≥ 3 and you are making a universal claim.

**Validator correctness**: An incorrect validator that always returns "pass" is worse than a trace, because it adds false confidence programmatically. Validate the validator by injecting a known-bad item and confirming it fails. If the validator can't be made to fail on a known violation, it's not checking what you think it's checking.

**Performance**: For large batches (N > 10,000) or expensive property checks, full enumeration may be cost-prohibitive. In these cases, use stratified sampling — but be explicit that sampling shifts the guarantee from universal ("all items satisfy P") to probabilistic ("≥95% of items satisfy P at 99% confidence"). A sampling-based result is not a substitute for an enumeration-based universal claim; it is a weaker claim that must be stated as such in any downstream documentation or assertion.

## Related Patterns

- **[Empirical Validation Loop](/agent-prompt-patterns/patterns/empirical-validation-loop)** — validates hypotheses via measurement across agent runs; this pattern validates batch properties via enumeration before the batch ships. They compose: use Empirical Validation Loop to learn which properties need enumeration, then use this pattern to enforce them.
- **[Side-Effect Verification](/agent-prompt-patterns/patterns/side-effect-verification)** — verifies post-conditions after individual operations; this pattern verifies invariants across entire collections. Side-Effect Verification asks "did this one action produce its intended outcome?"; Enumeration-First asks "do all N outputs satisfy the stated property?"
- **[Pre-Commit Planning Phase](/agent-prompt-patterns/patterns/pre-commit-planning-phase)** — the planning phase is the right moment to ask "what enumerable invariants must this batch satisfy before commit?" Writing the invariant checks during planning, rather than after generation, ensures they're specific enough to be implemented.
