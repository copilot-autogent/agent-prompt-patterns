---
title: "Scope Boundary Declaration"
category: "task-design"
evidenceLevel: "moderate"
summary: "Emit an explicit IN/OUT scope declaration before making any changes, then enforce it throughout execution by noting out-of-scope discoveries rather than fixing them"
relatedPatterns: ["long-horizon-task-phasing", "bounded-autonomy", "uncertainty-gated-irreversible-action", "pre-commit-planning-phase", "phase-gated-epic-body"]
tags: ["scope", "task-design", "boundaries", "blast-radius", "yagni", "pr-hygiene", "no-unused-surface", "task-intake"]
---

## Problem

An agent is given a focused task: "Fix the date parsing bug in the invoice module." Three hours later the PR touches the invoice module, the date utility shared across four other modules, the test harness, two unrelated style inconsistencies, and includes a new validation helper that "felt useful."

The blast radius of a seemingly small task has expanded 10×. Review is harder. Regression risk is higher. The actual bug fix is buried in a diff that's difficult to reason about.

Two structural failure modes produce this outcome:

**Opportunistic expansion**: While making the requested change, the agent notices a related issue and fixes it. Each fix is locally reasonable ("while I'm here"). The cumulative drift is large. No single step felt like overreach; the aggregate was.

**Feature creep**: The agent ships a generalized version of what was requested, adding API surface, config options, or utility modules "for future use." The additions pass tests, go unused, and become maintenance burden and dead code.

**Observed failure signatures:**

- A sprint agent shipped `factorMomentum.js` with 38 passing unit tests. The module was never imported. It existed only as a dependency of itself. The audit that found it revealed ~2000 LOC of unused self-built surface accumulated across multiple such expansions.
- Refactoring a shared utility to "make the change easier" without declaring the expanded scope — the PR touched 14 files when 2 were in scope.
- Style normalization across a file when the task only required changing one function — "the inconsistency was distracting."

The common root cause is the absence of an explicit, declared scope boundary. Without one, the agent's natural optimization — "do good work" — is unbounded. "Good work" expands to fill available context.

## Context

This pattern applies to any non-trivial agent task, especially:

- Tasks with a clear, narrow request (bug fix, single-feature addition, targeted refactor)
- Sprint agents that operate with significant autonomy and tool access
- PRs where blast radius matters (reviewed by humans, deployed to production, or touching shared utilities)
- Multi-agent pipelines where each agent's output is the next agent's input — unexpectedly expanded scope compounds downstream

It is less critical for:
- Greenfield work where the full scope is intentionally open
- Scaffolding tasks where the agent is explicitly asked to "do what's needed"
- Exploratory research phases where breadth is the goal

Even in open-ended work, a scope declaration is useful — it surfaces assumptions and creates an opportunity for scope alignment before any changes are made.

## Solution

**At task intake, emit a scope declaration. Enforce it throughout execution. Treat every out-of-scope discovery as a note or filed issue, not an action.**

### 1. Scope declaration at intake

Before writing any code or making any changes, produce a structured scope block:

```
## Scope
IN:  [list of files, modules, behaviors, or systems this change will touch]
OUT: [explicit exclusions — what I am NOT changing, even if related or obviously improvable]
```

This declaration goes in the PR body, plan file, or task preamble — whichever exists at intake. If no PR is open yet, write it in the plan file or task notes before any edits begin. When a PR is opened, move or copy the declaration into the PR body so reviewers can verify containment.

**Scope declaration examples:**

```
## Scope
IN:  src/invoice/date-parser.ts — fix off-by-one in fiscal quarter calculation
OUT: src/utils/date.ts (shared utility — not touching even if related bugs exist)
     src/invoice/formatter.ts (related module — separate concern)
     test infrastructure (no harness changes)
```

```
## Scope
IN:  src/content/patterns/scope-boundary-declaration.md — new pattern file
OUT: Any existing pattern files (no edits, even for related cross-references)
     Site config, layout, or navigation files
```

The OUT list is as important as the IN list. Naming what you are NOT touching makes the boundary legible to reviewers and anchors the agent against drift.

### 2. Enforcement during execution

Every action taken after the scope declaration should be checked against it. Before editing a file, the agent asks: *Is this file in scope?*

If the answer is no:

1. Record the discovery in the PR body, plan file, or a new GitHub issue — do NOT touch the out-of-scope file.
2. Continue with the in-scope work.

Recording in the PR body is preferred when a PR is open: it is visible to reviewers without modifying any file. Before a PR exists, record in the plan file or task notes. Filing a separate issue is appropriate when the discovery is significant enough to track as independent work.

The note or filed issue is the full response to an out-of-scope discovery. It does not warrant expanding the PR.

### 3. Boundary crossing — when it's unavoidable

Occasionally a bug or issue is so tightly coupled to the in-scope change that leaving it unfixed makes the in-scope change incorrect or incomplete. In these cases:

1. **Stop and classify**: Is this change load-bearing for the current task, or merely related?
2. **If load-bearing**: document the boundary crossing explicitly in the PR body: "Crossed scope boundary: changed `src/utils/date.ts` because the in-scope fix is incorrect without it. The change is [description]."
3. **Update the scope declaration**: add the new file to the IN list with the reason.
4. **If not load-bearing**: leave it. File an issue. Move on.

Boundary crossings are not failures — they happen. Undocumented boundary crossings are failures. The requirement is transparency, not never crossing.

### 4. Scope declaration in the PR body

The PR body should include the scope block. Reviewers can use it to verify completeness (everything IN was touched) and containment (nothing OUT was touched):

```
## Scope
IN:  src/invoice/date-parser.ts
OUT: src/utils/date.ts, src/invoice/formatter.ts

Part of #NNN
```

A reviewer who spots an edit outside the IN list and not in the OUT exclusions has found either an accidental change or an undocumented boundary crossing — both worth flagging.

### Anti-patterns

**"While I'm here, I'll also fix X"**: The canonical scope expansion trigger. Unless X is load-bearing for the current task, don't. File an issue for X.

**Refactoring a shared utility to make the change easier**: This is scope expansion with a rationalization. The utility refactor is a separate task. If you need it, file it, complete it, then return to the original task.

**Style normalization across unrelated code**: "The inconsistency was distracting" is not a task requirement. Style changes belong in dedicated style PRs.

**Shipping bonus features**: A feature the user didn't ask for is a feature they didn't review, didn't test, and didn't ask to maintain. YAGNI applies: if nothing in the task description calls for it, don't build it.

**Expanding scope without updating the declaration**: If you do cross a boundary, update the scope block. A stale scope declaration is worse than no declaration — it gives reviewers false confidence about containment.

## Evidence

**Unused module accumulation audit**: A codebase audit found ~2000 lines of code across multiple sprint-built modules that were never imported or called. Each module was internally consistent, tested, and syntactically correct. Each had been added in a sprint that was nominally scoped to a different feature. The modules exist because each sprint agent encountered a perceived gap and filled it — without a declared scope to push back against the impulse.

**factorMomentum.js case**: Sprint agent #105 was scoped to add a specific analytics feature. The PR included `factorMomentum.js` with 38 passing unit tests. The module was never wired into the application. PR diff analysis revealed the entry-point file — the file that would have made the module active — was never touched. The agent built a complete, tested module and shipped it unused. No scope declaration had been made.

**14-file PR from 2-file scope**: A bug fix in a shared date utility required changes to two files. The actual PR touched 14. The additions were style normalizations, comment updates, and one new utility function "needed by other callers." The bug fix was correct. The additions introduced a regression in one of the normalized files. Review missed it because the blast radius was too large to scrutinize each change.

**Copilot CLI playbook rule**: "Don't fix pre-existing issues unrelated to your task." This rule was added to the playbook after recurring pattern of sprint agents expanding into pre-existing issues during nominally scoped work. The rule is effective when it's in the prompt; it requires re-learning when it's not. A scope declaration embeds the same principle into the task rather than relying on a global rule being active.

## Tradeoffs

**Benefit**: Dramatically reduces PR blast radius. Makes reviews faster and higher-signal. Reduces regression risk from incidental changes. Creates accountability for scope decisions — both agent and reviewer can see what was declared and what was delivered.

**Cost**: Requires an upfront scope declaration before implementation begins. For very small tasks (single-function changes), this may feel like overhead. The declaration is still worthwhile — it takes 30 seconds to write and anchors the entire execution.

**Watch out for:**

- **Over-narrow IN list**: A scope that's too restrictive produces an incomplete change. If the fix genuinely requires touching three files, declare all three. The goal is honesty, not minimalism.
- **Vague OUT list**: "Not touching unrelated things" is not a useful exclusion. Name specific files, modules, or behaviors you're aware of and excluding. Vague exclusions don't anchor against drift.
- **Declared scope vs. actual scope drift**: If implementation reveals the scope was wrong — more files are genuinely needed — update the declaration before proceeding. Don't let the declaration become a historical artifact that no longer matches reality.
- **Scope declaration as cover for over-caution**: Some agents over-correct and refuse to make obviously related, load-bearing changes because they're "out of scope." The pattern is not a mechanism for paralysis — it's a mechanism for intentional, transparent scope decisions.

## Related Patterns

- **[Long-Horizon Task Phasing](/agent-prompt-patterns/patterns/long-horizon-task-phasing)** — uses scope declarations at the phase level; each phase has an IN/OUT specification that prevents phase N work from bleeding into phase N+1 scope. Scope boundary declaration is the per-task primitive; long-horizon task phasing is the per-phase composition.
- **[Bounded Autonomy](/agent-prompt-patterns/patterns/bounded-autonomy)** — defines what actions an agent can take unilaterally vs. what requires escalation; scope boundary declaration defines which targets are in-range for any action. Both patterns constrain the action space: bounded autonomy along the authorization axis, scope declaration along the target axis.
- **[Uncertainty-Gated Irreversible Action](/agent-prompt-patterns/patterns/uncertainty-gated-irreversible-action)** — scope expansion is itself an irreversible action (merging code cannot be un-merged without effort); when uncertainty about scope arises, treat the expansion proposal as an irreversible action and apply the uncertainty gate before proceeding.
- **[Pre-Commit Planning Phase](/agent-prompt-patterns/patterns/pre-commit-planning-phase)** — scope declaration belongs in the pre-commit planning phase, before any edits are made; the planning phase is the natural home for IN/OUT declaration and is the point where scope mismatches are cheapest to catch.
