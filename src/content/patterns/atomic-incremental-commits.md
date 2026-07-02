---
title: "Atomic Incremental Commits"
category: "task-design"
evidenceLevel: "moderate"
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

When a worktree contains changes spanning multiple concerns, use selective staging to commit each concern independently: stage only the files belonging to one logical change, commit, then stage the next. When two concerns touch the same file, use hunk-level staging to include only the relevant lines. This prevents mixed commits even when edits to multiple concerns are already in flight.

**Rule 2 — Commit on every stable checkpoint.** A checkpoint is any moment where the working tree is correct and tests pass. Examples:
- After passing tests for a single module
- After fixing a lint error
- After wiring a single component into the application
- After completing one phase of a multi-phase task

The cost of a commit is near zero. The cost of losing a checkpoint is the time to reconstruct it.

**Rule 3 — Never accumulate across unrelated concerns.** A database schema change and a UI tweak are separate commits when each can be independently deployed and reverted without breaking the other. The test: *would reverting this commit affect behavior in two domains that could independently be correct or broken?*

Important: *git-level atomicity is not the same as operation-level rollback safety.* Reverting a commit does not undo external state changes — a schema migration that was applied to a live database, or a file written to object storage, persists after the commit is reverted. Commit separation improves code reviewability and git history clarity; it does not substitute for an application-level rollback strategy for irreversible operations.

Caveat: if two changes are tightly coupled — for example, a schema migration that requires an immediate application-layer change to keep the system runnable — they should be committed together as a single atomic unit. Splitting them would create a broken intermediate commit that violates Rule 2 (every commit must be independently runnable). In these cases, use an explicitly backward-compatible migration strategy (e.g., additive schema change first, then migrate reads/writes, then remove old columns) to create naturally splittable commits.

**Rule 4 — Commit before experimenting.** Before trying an approach that may not work, commit the last known-good state. The committed checkpoint is the recovery point for tracked file changes: abandon the experiment and restore tracked files to clean state without losing validated work. Note that untracked files, generated artifacts, and external state (databases, caches, feature flags) are not restored by reverting to a git checkpoint — scope this recovery strategy accordingly.

### Rollback blast radius rule

The cost of a bad commit ≈ lines changed × coupling factor. Keep commits small enough that reverting one doesn't undo unrelated good work. If a single commit touches both a schema and a UI component, reverting for a schema bug also loses the UI fix. These two concerns have independent coupling — they should be independent commits.

### When to defer a commit

Deferring a commit is only correct when:
1. The working tree is in an invalid intermediate state (tests don't pass, code doesn't compile)
2. The change is genuinely incomplete — a half-wired component that would be misleading as a standalone commit
3. Two changes are tightly coupled and splitting them would create a broken intermediate commit (see Rule 3 caveat)

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
- **Accumulating local commits without pushing** — local-only commits create a single point of failure if the session dies; push (or otherwise persist) each logical unit so that the recovery point survives a session restart (applicable where pushing partial branches is permitted by team policy)

## Evidence

**Sprint failure recovery**: In autonomous multi-agent sprint systems, sprints that die mid-flight (auth errors, timeouts, process kills) leave partial work. The recovery path depends entirely on what was committed before the failure. Sprints with granular commits leave a recoverable artifact at the last stable checkpoint. Sprints with a single end-of-sprint commit lose everything if the commit didn't happen before the failure. In a sample of 7 sprint failures on factor-dashboard and shogi-srs, 5 had no intermediate commits and required full re-runs; 2 had intermediate commits and recovered from the last checkpoint without re-running earlier phases.

**Deploy bisection (factor-dashboard, June 2026)**: A regression appeared in production after a sprint whose branch history was not preserved — 12 intermediate steps had been squashed before being pushed. The regression was in one of the 12 steps, but no bisection was possible because each step was not individually revertable in the push history. Manual code archaeology took 45 minutes to locate the responsible change. In workflows that preserve branch commit history (merge commits, or non-squash pushes), having each step as a separate commit enables `git bisect` to isolate the regression automatically.

**Workflow policy grounding**: Several team workflow policies (e.g., "push regularly, notify on completion") were introduced to address incidents where agents completed extended sessions without persisting their work, then lost everything when the session ended. Granular incremental commits are the mechanism that makes progressive persistence practical — there is always a stable, atomic unit available to push.

**Large-commit review miss**: A PR with 14 files and a single commit message `"implement feature X"` was reviewed and merged. A subtle off-by-one error was present in file 9 of 14. Post-merge incident analysis found the reviewer had reviewed files 1–6 closely, then skimmed the remaining 8. The diff was too large to sustain attention across its full length. The same change decomposed into 4 commits of 3–4 files each would have been fully reviewed — each commit boundary signals a concern boundary, prompting fresh attention.

## Tradeoffs

**Benefit**: Each commit is an independently revertable, bisectable unit. Recovery from failure is cheap — reset to the last checkpoint and resume. PR review blast radius is bounded. Bisection is fast. The cost of any bad change is proportional to the size of one atomic commit, not the entire changeset.

**Cost**: Committing more frequently requires discipline at task execution time. The agent (or human) must actively decide "this is a stable checkpoint" rather than committing only at task completion. For trivially small tasks, this discipline overhead may exceed the task itself.

**Watch out for:**

- **Over-atomization**: Commits that are too small create noise. A one-line typo fix alongside a one-line style fix are reasonable candidates for a single commit. The test is independent revertability, not pure line count.
- **False checkpoints**: Committing code that doesn't pass tests in order to "get a checkpoint" creates a commit history that is not bisectable — every commit must be independently runnable. A checkpoint that breaks tests is worse than no checkpoint, because it undermines the bisect guarantee.
- **Tightly-coupled cross-layer changes**: Not all cross-concern changes can be split without creating broken intermediate commits (see Rule 3 caveat). Use additive migration strategies to create naturally splittable checkpoints rather than forcing a split that would leave the system temporarily broken.
- **Git atomicity vs. operation atomicity**: A git revert undoes tracked file changes; it does not undo applied migrations, written files, or external service calls. Atomic commits reduce blast radius within the codebase; they do not replace application-level rollback strategies for irreversible operations.
- **Atomic commits vs. atomic PRs**: This pattern concerns commits within a branch/session. PR-level atomicity (each PR is one independently deployable feature) is a separate concern handled by Scope Boundary Declaration. Both apply; they operate at different granularities.
- **Squash-merge PR workflows**: In workflows where all branch commits are squashed into one at merge time, commit granularity is invisible in `main`'s history. This is fine — the granularity still serves its in-flight recovery purpose within the branch. The squash-merge is appropriate at the PR boundary; the commit granularity discipline is appropriate during development.

## Related Patterns

- **[Verification Before Completion](/agent-prompt-patterns/patterns/verification-before-completion)** — verification at each commit boundary ensures the commit is a genuine stable checkpoint, not a false positive; atomic commits create natural verification boundaries where the agent can confirm the change is correct before moving on
- **[Long-Horizon Task Phasing](/agent-prompt-patterns/patterns/long-horizon-task-phasing)** — phases map to commit batches; each phase boundary is a natural commit point where the accumulated work of the phase is checkpointed as an atomic unit before the next phase begins
- **[Scope Boundary Declaration](/agent-prompt-patterns/patterns/scope-boundary-declaration)** — the IN/OUT scope declaration defines which files are in-scope; atomic commits enforce this at the commit level by keeping each commit to one logical concern; together they bound both the target set and the commit granularity
- **[Pre-Commit Planning Phase](/agent-prompt-patterns/patterns/pre-commit-planning-phase)** — pre-commit planning identifies the sequence of changes before implementation begins; planned sequences map naturally to atomic commits, because each planned step is a candidate commit boundary
