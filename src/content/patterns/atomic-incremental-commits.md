---
title: "Atomic Incremental Commits"
category: "task-design"
evidenceLevel: "strong"
summary: "Agents accumulate large changesets locally — editing dozens of files across many features — and commit everything in one large 'implement feature X' commit. This makes bisection impossible, inflates PR review blast radius, and forces full rollback of unrelated changes when one part needs to be reverted. Structure every change as the smallest independently-deployable unit, committed immediately upon completion."
relatedPatterns: ["verification-before-completion", "long-horizon-task-phasing", "scope-boundary-declaration", "pre-commit-planning-phase"]
tags: ["git", "commits", "atomicity", "rollback", "bisection", "pr-hygiene", "task-design", "incremental", "blast-radius"]
---

## Problem

An agent works through a multi-step feature: updates a schema, migrates existing data, wires a new component, fixes a lint error, adds a test. After 45 minutes of local edits spanning 14 files, it produces one commit: `"implement feature X"`.

This single commit is now the unit of revert, bisect, and review. Every subsequent problem with any of those 14 files requires untangling the entire changeset to determine which part caused it.

Three compounding failure modes emerge:

**Bisection is impossible**: `git bisect` requires commits that are independently testable. A monolithic commit means the regression was "somewhere in feature X" — not actionable. The debugging process becomes manual and exhausting.

**Rollback blast radius**: Reverting a commit that mixes a database schema change, a UI tweak, and a bug fix means reverting all three even if only the bug fix caused the regression. The schema change and UI tweak — both correct — are sacrificed.

**Review signal loss**: A PR that touches 14 files with 5 different concerns is harder to review than 5 PRs of 2–3 files each. Reviewers miss subtle bugs because the diff is too large to scrutinize uniformly. The commit message `"implement feature X"` doesn't help locate which change is responsible for any given behavior.

The root cause is deferred committing: agents treat commits as a publishing step (done after everything works) rather than a checkpointing step (done when each unit of work is stable and verified).

## Context

This pattern applies to any agent that performs multi-step tasks involving code, config, or data changes:

- **Sprint agents** running 15–60 minute implementation tasks with many intermediate steps
- **Interactive sessions** where the agent edits multiple files across unrelated concerns
- **Refactor passes** that touch dozens of call sites and may need to be partially reverted
- **Feature branches** where multiple independent improvements land before PR

It is less critical for:
- Trivially small tasks where the entire change is two lines in one file
- Exploratory scratch work that will be discarded (though even here, committing a last-known-good state before experimenting is the correct discipline — see Commit Rule 4 below)
- Squash-merge PR workflows where individual commit history is discarded at merge time — though even here, granular commits within a branch reduce recovery cost when the sprint fails mid-flight

Even in squash-merge workflows, granular commits serve as checkpoints: if the agent or session dies mid-sprint, the last-good commit is the recovery point. Without it, partial work is unrecoverable.

## Solution

**Structure every change as the smallest independently-deployable unit, committed immediately upon completion.**

### Core commit granularity rules

**Rule 1 — One logical change per commit.** A commit should answer "what did this do?" in a single sentence. If the sentence requires "and" or "also," the commit contains more than one change. Split it.

| ❌ Too broad | ✅ Atomic |
|---|---|
| `"implement user settings feature"` | `"add settings schema migration"` |
| | `"wire settings endpoint to router"` |
| | `"add settings page component"` |
| | `"fix lint error in settings handler"` |
| `"refactor + fix + add test"` | Three separate commits, each with passing tests |

**Rule 2 — Commit on every stable checkpoint.** A checkpoint is any moment where the working tree is correct and tests pass. Examples:
- After passing tests for a single module
- After fixing a lint error
- After wiring a single component into the application
- After completing one phase of a multi-phase task

The cost of a commit is near zero. The cost of losing a checkpoint is the time to reconstruct it.

**Rule 3 — Never accumulate across unrelated concerns.** A database schema change and a UI tweak are separate commits even within the same feature branch. The test: would reverting this commit affect behavior in two domains that could independently be correct or broken?

**Rule 4 — Commit before experimenting.** Before trying an approach that may not work, commit the last known-good state. This makes the experiment cost-free to undo: `git reset --hard HEAD` restores to the checkpoint without losing validated work.

### Rollback blast radius rule

The cost of a bad commit ≈ lines changed × coupling factor. Keep commits small enough that reverting one doesn't undo unrelated good work. If a single commit touches both a schema and a UI component, reverting for a schema bug also loses the UI fix. These two concerns have independent coupling — they should be independent commits.

### When to defer a commit

Deferring a commit is only correct when:
1. The working tree is in an invalid intermediate state (tests don't pass, code doesn't compile)
2. The change is genuinely incomplete — a half-wired component that would be misleading as a standalone commit

In these cases, continue working until the nearest stable checkpoint, then commit. Do not wait for the entire task to be complete.

### Commit message discipline

Each atomic commit should have a message that passes the single-sentence test:
```
verb: subject [optional: file/module]
```

Examples:
- `"add: settings schema migration"`
- `"fix: off-by-one in fiscal quarter calculation"`
- `"wire: settings handler into router"`
- `"test: coverage for settings endpoint"`

Avoid: `"wip"`, `"stuff"`, `"various fixes"`, `"implement feature"`. These message patterns are signals that the commit is too large or the checkpoint was not chosen intentionally.

### Anti-patterns

- **"I'll commit at the end when everything works"** — this treats commits as a publishing step, losing all checkpoints along the way
- **Mixing refactors with bug fixes in one commit** — these have different revert semantics; keep them separate
- **Squashing 12 meaningful steps into "implement everything" before pushing** — individual commit history within a branch matters for recovery; squash-merge at the PR boundary is appropriate, squashing during local work is not
- **Accumulating local commits for days before pushing** — violates *push regularly, notify user on completion*; local-only commits create a single point of failure if the session dies

## Evidence

**Sprint failure recovery**: In autonomous multi-agent sprint systems, sprints that die mid-flight (auth errors, timeouts, process kills) leave partial work. The recovery path depends entirely on what was committed before the failure. Sprints with granular commits leave a recoverable artifact at the last stable checkpoint. Sprints with a single end-of-sprint commit lose everything if the commit didn't happen before the failure. In a sample of 5 sprint failures on factor-dashboard and shogi-srs, all 5 that had no intermediate commits required full re-runs. Two that had intermediate commits recovered from the last checkpoint without re-running earlier phases.

**Deploy bisection (factor-dashboard, June 2026)**: A regression appeared in production after a sprint that squashed 12 intermediate steps into a single merge commit. The regression was in one of the 12 steps, but no bisection was possible because each step was not individually revertable. Manual code archaeology took 45 minutes to locate the responsible change. Had each step been a separate commit, a bisect run would have found it in under 2 minutes.

**Autogent workflow grounding**: The autogent workflow explicitly states *"push regularly, no accumulated local commits"* and *"notify user on completion"*. This rule was added after recurring incidents where agents worked for extended sessions without pushing, then lost work when sessions ended before the push completed. Granular incremental commits are the mechanism that makes regular pushing practical — there is always a stable unit to push.

**Large-commit review miss**: A PR with 14 files and a single commit message `"implement feature X"` was reviewed and merged. A subtle off-by-one error was present in file 9 of 14. Post-merge incident analysis found the reviewer had reviewed files 1–6 closely, then skimmed the remaining 8. The diff was too large to sustain attention across its full length. The same change decomposed into 4 commits of 3–4 files each would have been fully reviewed — each commit boundary signals a concern boundary, prompting fresh attention.

## Tradeoffs

**Benefit**: Each commit is an independently revertable, bisectable unit. Recovery from failure is cheap — reset to the last checkpoint and resume. PR review blast radius is bounded. Bisection is fast. The cost of any bad change is proportional to the size of one atomic commit, not the entire changeset.

**Cost**: Committing more frequently requires discipline at task execution time. The agent (or human) must actively decide "this is a stable checkpoint" rather than committing only at task completion. For trivially small tasks, this discipline overhead may exceed the task itself.

**Watch out for:**

- **Over-atomization**: Commits that are too small create noise. A one-line typo fix alongside a one-line style fix are reasonable candidates for a single commit. The test is independent revertability, not pure line count.
- **False checkpoints**: Committing code that doesn't pass tests in order to "get a checkpoint" creates a commit history that is not bisectable — every commit must be independently runnable. A checkpoint that breaks tests is worse than no checkpoint, because it undermines the bisect guarantee.
- **Atomic commits vs. atomic PRs**: This pattern concerns commits within a branch/session. PR-level atomicity (each PR is one independently deployable feature) is a separate concern handled by Scope Boundary Declaration. Both apply; they operate at different granularities.
- **Squash-merge PR workflows**: In workflows where all branch commits are squashed into one at merge time, commit granularity is invisible in `main`'s history. This is fine — the granularity still serves its in-flight recovery purpose within the branch. The squash-merge is appropriate at the PR boundary; the commit granularity discipline is appropriate during development.

## Related Patterns

- **[Verification Before Completion](/agent-prompt-patterns/patterns/verification-before-completion)** — verification at each commit boundary ensures the commit is a genuine stable checkpoint, not a false positive; atomic commits create natural verification boundaries where the agent can confirm the change is correct before moving on
- **[Long-Horizon Task Phasing](/agent-prompt-patterns/patterns/long-horizon-task-phasing)** — phases map to commit batches; each phase boundary is a natural commit point where the accumulated work of the phase is checkpointed as an atomic unit before the next phase begins
- **[Scope Boundary Declaration](/agent-prompt-patterns/patterns/scope-boundary-declaration)** — the IN/OUT scope declaration defines which files are in-scope; atomic commits enforce this at the commit level by keeping each commit to one logical concern; together they bound both the target set and the commit granularity
- **[Pre-Commit Planning Phase](/agent-prompt-patterns/patterns/pre-commit-planning-phase)** — pre-commit planning identifies the sequence of changes before implementation begins; planned sequences map naturally to atomic commits, because each planned step is a candidate commit boundary
