---
title: "In-Context Exemplar Grounding"
category: "prompt-structure"
evidenceLevel: "strong"
summary: "When a prompt specifies format-sensitive constraints (enum values, schema fields, output structure), include at least one concrete worked example inline rather than relying on prose description alone. Abstract 'valid values are A|B|C' instructions are followed inconsistently without a visible example — agents pattern-match on plausible-sounding alternatives. Show the valid form directly in context, adjacent to the constraint."
relatedPatterns: ["structured-output-template", "schema-validation-before-processing", "pre-synthesis-self-critique", "ambiguity-threshold-clarification", "enumeration-first-verification"]
tags: ["format-compliance", "exemplar", "enum", "schema", "grounding", "prompt-structure", "build-safety", "in-context-learning"]
---

## Problem

An agent receives a prompt or issue body that describes a format constraint in prose:

> "Set `evidenceLevel` to one of: strong, moderate, or emerging."

The agent produces `evidenceLevel: "promising"`. The build breaks. The root cause is not model incapability — it is that prose descriptions of valid values are processed as text, not as grounding anchors. Without seeing a valid output form, the agent pattern-matches on plausible-sounding alternatives rather than the exact valid set.

This failure mode is distinct from related patterns:

- **`schema-validation-before-processing`** validates at runtime after data has already been written; it does not affect how the agent writes data in the first place.
- **`structured-output-template`** provides a template for agent output structure; it does not provide value-level examples inside constrained fields.
- **`enumeration-first-verification`** lists valid values before verifying; it is about discovery, not format grounding at write time.

The pattern recurred across multiple deployment cycles in the `agent-prompt-patterns` project. Sprint #95 used `evidenceLevel: "promising"` despite the issue body describing the valid values in prose (`"evidenceLevel: strong/moderate/emerging"`). The build failed and required hotfix PR #101. The same class of error recurred on subsequent sprints until CONTEXT.md was updated with an inline example format: `evidenceLevel: 'strong'   # valid: strong | moderate | emerging`. After that change — a single concrete exemplar, not a validator change — zero frontmatter enum errors recurred across all subsequent sprints.

## Context

This pattern applies whenever a prompt or task specification contains format-sensitive constraints: enum fields, schema field names, structured output fragments, required syntax patterns, or any field where "close but wrong" counts as a failure. It is most critical when:

- **Enum fields with non-obvious valid values** — values where the agent's prior distribution over plausible alternatives is broader than the valid set (e.g., `"promising"` sounds like a reasonable evidence level; it isn't)
- **Nested structures where field name alone is ambiguous** — the field name hints at the intent but not the exact valid form
- **Any field class that has produced format errors before** — a prior failure is a strong signal that the prose-only form is insufficient
- **Output sections where "close but wrong" counts as a build failure** — frontmatter enums, API request bodies, CI configuration fields

The pattern applies during prompt authoring, issue body writing, and task specification — not at runtime validation. Its leverage is prevention, not detection.

## Solution

For any format-sensitive constraint in a prompt or task body, include a **concrete worked example of a valid output** immediately adjacent to the constraint.

### Basic form

```
# Instead of:
Set evidenceLevel to one of: strong, moderate, or emerging.

# Use:
Set evidenceLevel to one of the valid values:
  evidenceLevel: "strong"   # also valid: "moderate" | "emerging"
```

The key structural difference: the valid value appears in the exact form the agent must produce it, not in a comma-separated list after a colon. The inline comment enumerates the alternatives without making them syntactically equivalent to the example.

### Multi-field schemas

For structured output with multiple constrained fields, provide a minimal complete valid example rather than field-by-field prose descriptions:

```
# Instead of:
Frontmatter fields:
- title: string
- category: one of prompt-structure, task-design, agent-autonomy, feedback-loops, memory-management, multi-agent
- evidenceLevel: one of strong, moderate, emerging

# Use:
Frontmatter example (use exactly these field names and value formats):
---
title: "Pattern Name"
category: "prompt-structure"   # valid: prompt-structure | task-design | agent-autonomy | feedback-loops | memory-management | multi-agent
evidenceLevel: "strong"        # valid: strong | moderate | emerging
---
```

The multi-field example serves two grounding purposes simultaneously: it shows field names in their exact required form, and it shows each value in its exact valid form — including whether string quoting is required.

### Placement rules

1. **Adjacent, not appended**: The exemplar must appear immediately next to the constraint, not in a footnote or appendix at the end of the document. The agent must see the exemplar in the same attention window as the constraint.
2. **Same syntax as the target**: If the agent will write YAML, show YAML. If the agent will write JSON, show JSON. Do not show a Python dict example for a field that must be YAML.
3. **Minimal, not maximal**: Show the smallest valid form that demonstrates the constraint. An overly complete example dilutes the grounding signal with noise.

### Selection heuristics

1. **Always apply**: enum fields with non-obvious valid values
2. **Always apply**: nested structures where field name alone is ambiguous
3. **Always apply when prior failures observed**: any field class that has caused format errors before
4. **Always apply**: output sections where "close but wrong" counts as a build failure (frontmatter enums, API request bodies, CI config fields)

## Evidence

**autogent sprint log (direct observation):** Sprint #95 (`agent-prompt-patterns` repo) used `evidenceLevel: "promising"` in a frontmatter block despite the issue body specifying the valid values in prose. Build failed; required hotfix PR #101. The same class of error recurred on multiple subsequent sprints until an inline example (`evidenceLevel: 'strong'   # valid: strong | moderate | emerging`) was added to CONTEXT.md. After that single change — not a validator change, not a schema change, only a concrete exemplar added to the shared context — no frontmatter enum errors were observed across tracked subsequent sprints. The observation window covers the sprints documented in the autogent project history following the CONTEXT.md update. Effect size is large within the observation window; the sample is small and the confounds (fewer total sprints post-update, increased overall spec quality) are not controlled.

**arXiv 2406.03853:** Cited in the pattern specification as providing experimental support for in-context exemplars outperforming prose-only specifications in structured generation tasks. The directional claim is consistent with the autogent sprint observations above; specific figures from the paper should be verified independently before quoting.

**Empirical mechanism:** The failure mode (prose list → plausible-sounding alternative) is structurally predictable from how language models process constrained generation. A list of valid values in a sentence activates semantic neighbors as well as the exact list items. An inline example in the target syntax activates the model's copying/matching behavior — a higher-fidelity retrieval pathway than semantic association.

## Tradeoffs

**Positive**: Format error rates drop substantially on first attempt; fewer review rounds needed for purely mechanical corrections.

**Positive**: Examples serve as implicit validators — the agent can check its own output against the concrete form before submitting.

**Positive**: Examples self-document the constraint for human readers as well as agents; the prompt becomes easier to audit.

**Negative**: Slightly longer prompts. For most format-critical constraints this is an acceptable tradeoff; the prompt length overhead of one example line is far smaller than the cost of a broken build and hotfix round.

**Negative**: Must keep examples in sync when valid values change. A stale example showing an old valid value can actively misdirect the agent — worse than no example. Mitigation: treat inline exemplars as part of the spec, not as comments; update them whenever the valid value set changes.

**Scope boundary**: This pattern addresses write-time format grounding. It does not replace runtime validation (`schema-validation-before-processing`) or self-critique passes (`pre-synthesis-self-critique`). For high-stakes format-sensitive outputs, apply all three: exemplar grounding at prompt authoring time, self-critique before submission, and schema validation at ingestion.
