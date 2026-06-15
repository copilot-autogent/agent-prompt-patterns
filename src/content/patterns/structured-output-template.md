---
title: "Structured Output Template"
category: "task-design"
evidenceLevel: "moderate"
summary: "Recurring agent tasks that produce prose output exhibit format drift across runs — sometimes a table, sometimes bullets, sometimes flowing narrative. Include an explicit output template in the prompt. Show the exact structure the agent should follow. Format locks in; outputs become scannable and comparable across runs."
relatedPatterns: ["explicit-skip-permission", "sprint-continuity", "context-window-budgeting", "circuit-breaker"]
tags: ["scheduling", "recurring-agents", "output-format", "template", "format-drift", "digests", "surveys", "summaries", "prompt-design", "task-design"]
---

## Problem

A recurring agent task — daily digest, weekly survey, periodic status report — produces different output formats on every run. Sometimes a bulleted list. Sometimes a table. Sometimes flowing paragraphs. Each run looks hand-crafted, but inconsistent: difficult to scan, impossible to compare across runs, and unreliable for any downstream process that parses the output.

**Empirical anchor** (daily-academic-survey optimization):
The original prompt: "Find relevant papers and summarize them." Output varied across 3 consecutive runs:
- Run 1: bullet list with paragraph summaries
- Run 2: prose narrative grouping papers by theme
- Run 3: table with Title / Authors / Summary columns

After adding a fixed output template, format locked in. Three subsequent runs all matched the declared structure.

The root cause is not model inconsistency — it's prompt ambiguity. When the prompt does not specify format, the model picks one. Different runs may favor different representations for the same content. The agent is not wrong; it is unconstrained.

## Context

This pattern applies to any task where:

- The task runs on a schedule (daily, weekly, biweekly)
- A human or downstream process consumes the output
- You want to compare outputs across runs (trend detection, consistency audits)
- The output has multiple sections that might appear or disappear depending on the run
- The task is already working correctly — format drift is the only problem

It does **not** apply to:
- Exploratory tasks where structure IS the output ("discover what's important")
- One-off tasks where the overhead isn't worth it
- Creative tasks where variation is the goal

## Solution

**Include an explicit output template in the agent prompt. Show the exact structure — not just a description of it.**

The key distinction: *describing* a format ("produce a table with title, author, and summary") leaves formatting decisions to the model. *Showing* a format (copy-pasteable markdown skeleton) eliminates them.

**Minimal template:**

```
## Output format (copy this structure exactly)

### [Section Title]
| Column A | Column B | Column C |
|----------|----------|----------|
| ...      | ...      | ...      |

Notes: [any caveats or follow-up actions]
```

**What to template:**

- **Sections with headers** — agent won't invent or omit sections
- **Tables vs bullets** — prevents arbitrary format choice per run
- **Metadata fields** — date, source, confidence, evidence level
- **Terminal tokens** — an explicit ending marker prevents trailing ramble

**Anti-pattern it prevents:**

```
# BAD: prose-only instruction
"Summarize the papers you find."

# GOOD: explicit template
"Summarize the papers you find. Use this format exactly:

| Title | Authors | Relevance | Key Insight |
|-------|---------|-----------|-------------|
| ...   | ...     | ...       | ...         |
"
```

**Combining with skip permission:**

When used alongside [Explicit Skip Permission](/agent-prompt-patterns/patterns/explicit-skip-permission), include the skip case in the template itself:

```
## Output format

If nothing new was found, output exactly:
> No new items this run.

Otherwise:
| Title | Source | Key Point |
|-------|--------|-----------|
| ...   | ...    | ...       |
```

This prevents the agent from manufacturing content to fill the template when the honest answer is "nothing to report."

**Adding a quality signal:**

For tasks integrated with the [Circuit Breaker](/agent-prompt-patterns/patterns/circuit-breaker) pattern, append a terminal quality token to the template:

```
---
[QUALITY: N]  ← replace N with 1 (unusable) to 5 (excellent)
```

The quality token gives the circuit breaker a parseable signal without requiring the agent to restructure its output.

## Evidence

- **daily-academic-survey**: Fixed table template → format locked across 3 consecutive runs after 3 inconsistent runs before. Template addition was the only change between the inconsistent and consistent runs.
- **weekly-self-reflect**: Adding explicit topic list + format template → zero manufactured updates, format stable over 6+ runs. Pairs with Explicit Skip Permission.

Evidence level `moderate` — replicated across 2 independent task types, each with 3+ runs post-change.

## Tradeoffs

**Benefit**: Consistent, scannable output. Downstream parsing becomes reliable. Cross-run comparison is possible. Human readers develop expectations that are met every run.

**Cost**: Templates add prompt length. For tasks near the context ceiling, the overhead matters. Prefer compact templates (markdown tables over prose descriptions) and budget accordingly via [Context Window Budgeting](/agent-prompt-patterns/patterns/context-window-budgeting).

**Watch out for:**

- **Template hallucination**: A model that can't find content to fill a mandatory column may invent it rather than leave the cell empty. Explicitly permit empty cells: "If the value is unknown, write `—`."
- **Template rigidity**: A template designed for one content shape may produce awkward output when content doesn't fit. Allow one "Notes" freeform section as a release valve.
- **Stale templates**: As the task's output needs evolve, the template must evolve too. A template that doesn't match the task produces half-compliance — the model fills the template AND adds un-templated sections.

## Related Patterns

- **[Explicit Skip Permission](/agent-prompt-patterns/patterns/explicit-skip-permission)** — handles the no-output case; combine with a template to cover both the "nothing to report" and "something to report" branches
- **[Sprint Continuity](/agent-prompt-patterns/patterns/sprint-continuity)** — a sprint handoff manifest is a specialized output template applied to multi-session state; the same principle at a larger scope
- **[Context Window Budgeting](/agent-prompt-patterns/patterns/context-window-budgeting)** — templates add prompt overhead; budget for them explicitly in long-running sessions
- **[Circuit Breaker](/agent-prompt-patterns/patterns/circuit-breaker)** — append a `[QUALITY: N]` terminal token to your output template to give the circuit breaker a parseable signal without restructuring the output
