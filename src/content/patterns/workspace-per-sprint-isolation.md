---
title: "Workspace-per-Sprint Isolation"
category: "multi-agent"
evidenceLevel: "strong"
summary: "Each sprint agent must clone into a working directory uniquely keyed to its task or issue number (e.g., /tmp/<repo>-<issueNumber>-dev). Branch isolation is not sufficient: two git checkouts in the same directory clobber each other's staged and unstaged changes regardless of branch, producing contaminated commits that accidentally ship unreviewed work."
relatedPatterns: ["staggered-task-spawning", "duplicate-agent-spawn-prevention", "sprint-continuity", "side-effect-verification"]
tags: ["multi-agent", "concurrency", "working-tree", "isolation", "git", "sprint", "working-directory", "contamination"]
---

## Problem

A sprint supervisor dispatches two agents to work on different tasks in the same repository, either simultaneously or in close succession. Both agents default to the same working directory — typically `/tmp/<repo>-dev` — because their prompt templates are parameterized only on the repository name, not on the task.

When the first agent checks out its branch and accumulates uncommitted changes, the second agent's `git checkout` operates in the same directory. It does not erase the first agent's staged and unstaged changes. Those changes bleed silently into the second agent's commit.

The second agent squash-merges its PR. The merge bundle contains both agents' work. The first agent's changes shipped without its own review, without being linked to its issue, and without a corresponding PR trail.

Three failure signatures:

**Silent working-tree contamination**: `git status` inside a shared directory shows changes from the other agent. The contaminating agent has no idea; it never ran `git status` before staging. The contaminated agent runs `git diff --staged` and the output looks plausible — it happens to include the right changes plus extras it doesn't recognize.

**Branch isolation false safety**: The contaminating agent has already checked out its own branch. The contaminated agent checks out a different branch. Both operations succeed. Neither agent gets an error. The working tree still contains the other agent's modified files because `git checkout <branch>` only updates files tracked by that branch's history — it does not discard untracked files or unstaged modifications left by a different agent.

**Unrecognized "bonus" shipping**: The contaminated PR's summary includes a "Bonus:" or "Also fixed:" section describing features the issue never requested. The reviewer approves it. The bonus features are live in production, linked to the wrong issue, with no corresponding test coverage from their intended sprint.

## Context

This pattern applies any time:

- A supervisor or orchestrator dispatches multiple sprints to the **same repository**
- Those sprints may run **concurrently or with short time overlap**
- Sprint prompts derive the working directory from the repository name alone (e.g., `REPO_NAME=<repo> && DIR=/tmp/${REPO_NAME}-dev`)

It is particularly acute with **squash-merge + cleanup** workflows, where the first agent to merge also resets the branch. The contaminated files were never committed by either agent individually — they exist only in the shared working tree — so they vanish from history after the merge, making post-hoc forensics difficult.

The pattern does NOT apply to intentionally shared workspaces where multiple agents coordinate on a single long-lived task. It applies when each sprint is meant to produce an independent, self-contained changeset.

## Solution

**Key the working directory to the task, not to the repository.**

```
/tmp/<repo>-<taskId>-dev   ✅  unique per sprint
/tmp/<repo>-dev            ❌  shared, collision-prone
```

The task identifier can be an issue number, a sprint ID, or any token that is unique to the unit of work being performed. For sprints that retry or resume the same issue, append a run counter (`<issueNumber>-run2`) to ensure retries don't collide with a lingering previous attempt.

Apply this rule in three places:

**1. Sprint prompt templates**: Every sprint prompt that includes a `git clone` command must embed the task identifier in the clone path. For issue-backed tasks, use the issue number. For non-issue-backed tasks, use the sprint or task ID passed by the supervisor at dispatch time. Do not allow the path to be a runtime default derived only from the repo name.

```bash
# ✅ correct (issue-backed task)
WORK_DIR="/tmp/${REPO}-${ISSUE_NUMBER}-dev"
git clone <url> "$WORK_DIR"
cd "$WORK_DIR"

# ✅ correct (task-backed, non-issue)
WORK_DIR="/tmp/${REPO}-${TASK_ID}-dev"
git clone <url> "$WORK_DIR"
cd "$WORK_DIR"

# ❌ incorrect (shared, collision-prone)
WORK_DIR="/tmp/${REPO}-dev"
git clone <url> "$WORK_DIR"
cd "$WORK_DIR"
```

**2. Supervisor dispatch logic**: The orchestrator that spawns sprint agents must pass the task identifier to each sprint as a parameter, and must use it as part of the working directory path. If the supervisor uses a template with a fixed directory, the template is the bug. Supervisors that generate task identifiers (e.g., sprint IDs) must include those identifiers in the spawned agent's prompt context.

**3. Cleanup step**: The sprint's final action, on any exit path (success, failure, or cancellation), must remove its isolated working directory:

```bash
# Guard against empty variable before rm -rf
# Works for both ISSUE_NUMBER and TASK_ID conventions:
[[ -n "$REPO" && -n "$TASK_IDENTIFIER" ]] && rm -rf "/tmp/${REPO}-${TASK_IDENTIFIER}-dev"
```

The guard prevents accidental deletion of unexpected paths if either variable is unset or empty. Cleanup must be unconditional with respect to sprint outcome. Accumulated clone directories fill disk, and a stale directory from a previous sprint run can be mistaken for a live working tree by a subsequent sprint on the same issue.

### Why branch isolation is insufficient

A common misconception is that unique branch names protect against contamination. They do not.

`git checkout <branch>` switches the HEAD pointer and updates tracked files to match that branch's history. It does **not** remove untracked files or reset unstaged modifications to tracked files. If Agent A has added an untracked file or modified a tracked file without staging it, Agent B's `git checkout feat/B` leaves those changes in place. When Agent B runs `git add -A` or `git add .`, those files are staged under Agent B's commit.

The contamination is working-tree-level, not branch-level. Branch isolation is necessary but not sufficient. Working-directory isolation is sufficient by itself.

### Verification step

A sprint can defensively verify isolation at the start of its working session:

```bash
# Verify the working directory is clean before beginning work
cd "$WORK_DIR"
git status --short
# Expected: empty output (clean working tree)
# Any output indicates leftover state from a prior sprint run on this directory
```

This check detects leftover files from a previous (failed or interrupted) sprint that used the same working directory path — for example, a retry of the same issue number that did not clean up after itself. It does **not** protect against a race where two agents both start with a clean directory and then proceed concurrently; for that scenario, working-directory isolation itself is the protection (two agents with distinct paths cannot contaminate each other, regardless of timing).

If `git status` shows unexpected files, the sprint should stop, log the contamination, and alert rather than proceeding. Proceeding silently propagates the contamination into a PR.

## Evidence

**Incident 1 (ai-security-blog, 2026-06-15)**:

Sprint #26 (reading-time feature) and Sprint #33 (clickable tag pages) ran concurrently. Both cloned into `/tmp/ai-security-blog-dev`. Sprint #26 completed first and squash-merged PR #76. The merge accidentally bundled Sprint #33's uncommitted `encodeURIComponent` changes to `blog/index.astro`.

Sprint #33 discovered its work was partially shipped under PR #76 — a PR it never opened, against an issue it was not assigned to, without its test coverage. Sprint #33 had to open a residual-fix PR (#77) to ship the remainder of its work.

Neither sprint received an error. Neither sprint's `git log` showed contamination. The contamination was only discovered by diffing the merged commit against the expected changeset for the reading-time issue.

**Incident 2 (factor-dashboard, 2026-06-16)**:

Sprint #21 was dispatched the day after Incident 1, to a different repository. Sprint #20 was already running on factor-dashboard in `/tmp/factor-dashboard-dev` with uncommitted changes on branch `feat/20-factor-education-cards`. Sprint #21 cloned into the same directory and checked out its own branch. Sprint #21's first commit was contaminated by Sprint #20's working-tree changes.

Sprint #21 self-recovered by re-cloning into a separate directory (`/tmp/sprint21-clean`) and force-pushing a clean commit. The recovery confirmed the fix: an isolated working directory eliminated the contamination completely. No other change was needed.

**Recurrence significance**: The failure recurred within 24 hours on a different repository with a different supervisor. This confirms the failure mode is systemic in any sprint system that derives working directory from repository name alone. It is not an edge case.

## Tradeoffs

**Benefit**: Complete working-tree isolation between concurrent sprints. A sprint cannot contaminate or be contaminated by any other sprint's staged, unstaged, or untracked changes. The cost is a slightly longer clone path and one extra `rm -rf` at the end.

**Cost**: Each sprint clones the full repository independently. For large repositories, this increases disk usage and clone time proportional to the number of concurrent sprints. Shallow clones (`--depth=1`) mitigate this; they are appropriate for sprint work that starts from the current HEAD.

**Watch out for**:
- **Shared caches**: Some build systems cache dependencies in the repository directory (e.g., `node_modules` inside the repo root). An isolated working directory means each sprint rebuilds its dependency cache from scratch. This increases sprint startup time. Where possible, use a shared read-only cache outside the sprint's working directory and copy or link as needed.
- **Stale isolated directories**: If a sprint crashes before cleanup, its directory persists. A later sprint for the same issue will find the directory already exists from a previous run. The safest approach: delete and re-clone rather than reuse, unless the sprint has explicit resume logic.
- **Supervisor-level enforcement**: If the supervisor does not pass the issue number to the sprint, the sprint's prompt cannot construct an isolated path. Isolation requires the supervisor and the sprint prompt to agree on the parameterization. Verify this agreement at the template level, not at runtime.
- **Serialized same-repo sprints**: If a supervisor serializes sprints (one at a time per repo), working-tree contamination from active concurrent sprints is impossible — but a stale directory from a previous run of the same sprint can still cause problems. Isolation and cleanup apply even to serialized workflows.

## Related Patterns

- **[Staggered Task Spawning](/agent-prompt-patterns/patterns/staggered-task-spawning)** — addresses session concurrency limits at dispatch time; this pattern addresses working-directory contamination at the file system level. They are complementary: stagger spawns to avoid session cap failures, isolate directories to avoid working-tree contamination.
- **[Duplicate Agent Spawn Prevention](/agent-prompt-patterns/patterns/duplicate-agent-spawn-prevention)** — prevents two agents from working the same task simultaneously by verifying the artifact before spawning; this pattern prevents contamination when two agents legitimately work different tasks in the same repository at the same time.
- **[Sprint Continuity](/agent-prompt-patterns/patterns/sprint-continuity)** — defines what a sprint should preserve and restore across phases; an isolated working directory is a prerequisite for continuity: a sprint cannot safely resume into a directory that another sprint may have modified.
- **[Side-Effect Verification](/agent-prompt-patterns/patterns/side-effect-verification)** — the defensive `git status --short` check at the start of a sprint's working session is an application of this pattern: verify the working tree is clean before treating it as a safe starting state.
