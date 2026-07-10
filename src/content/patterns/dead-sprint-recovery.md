---
title: "Dead Sprint Recovery"
category: "multi-agent"
evidenceLevel: "moderate"
summary: "When a sprint agent dies mid-flight, the work it produced survives on the branch. The recovery cost is a verify-and-merge, not a full re-sprint. Check for an open PR before spawning a replacement — if one exists, clone, run tests, self-review the diff, and merge if green."
relatedPatterns: ["duplicate-agent-spawn-prevention", "side-effect-verification", "circuit-breaker", "observer-actor-separation", "sprint-completion-verification", "tool-error-triage", "pre-destruction-state-revalidation"]
tags: ["multi-agent", "recovery", "sprint", "dead-agent", "pr", "verify-and-merge", "connection-error", "resilience"]
---

## Problem

A sprint agent dies mid-flight — exhausting retries on a transient model connection error, hitting a wall-clock limit, or losing its session. It leaves no completion notification. The supervisor, seeing no signal, faces a choice: wait longer, spawn a replacement, or escalate.

Three failure signatures:

**Silent orphan**: The agent died after opening a PR but before posting its completion summary. The PR sits open and passing. The supervisor sees no completion notification within the expected window and spawns a replacement sprint. Both agents now target the same branch and working directory.

**Wasted re-sprint**: The replacement sprint re-runs the full implementation from scratch: clone, implement, test, review, refine — 45 minutes of work to reproduce an artifact that already existed and was green. The original work is discarded unused.

**Review tool idempotency trap**: The supervisor calls the automated review tool on the dead sprint's PR and gets `skipped_already_reviewed` — the tool deduplicates on PR head SHA and refuses to re-run without a new commit. The supervisor concludes the PR is unreviewed and either re-spawns or stalls.

The root cause is treating the *agent* as the unit of recovery rather than the *artifact*. The agent is gone; the artifact (committed branch, open PR) persists.

## Context

This pattern applies when:

- A sprint agent has a multi-phase lifecycle: implement → commit → open PR → review → refine → merge
- Agent death can occur at any phase, producing a partial artifact
- The supervisor receives no completion notification and must decide whether to wait, re-spawn, or recover
- The automated review tool is idempotent per head SHA (cannot be re-run without a new commit)

It is most relevant for coding sprints where the primary artifact is a PR with a passing test suite. Documentation or research sprints where the artifact is a file or report follow the same logic but may not have a test suite to validate against.

The pattern does NOT apply when the agent died before producing any artifact. If there is no open PR and no commits on the expected branch, there is nothing to recover — spawning a replacement is correct.

## Solution

**Check the artifact before spawning a replacement. If the artifact exists and is green, recover it rather than reproduce it.**

Apply this decision sequence when a sprint produces no completion notification within 2× its expected duration:

**Step 1: Query open PRs and branches for the task.**

Before spawning any replacement, check whether a PR or branch for this task already exists. Use the issue number as the primary discriminator — it is injected into branch names and sprint prompts and is the most stable identifier. Match the full `feat/<issue-number>-` prefix to avoid false positives (e.g., issue #71 matching a branch for issue #171):

```
open_prs = list_pull_requests(state="open")
task_pr = find_by(open_prs, head_branch starts_with "feat/<issue-number>-")
# Fallback: check whether the expected branch exists on the remote
branch_exists = remote_branch_exists("feat/<issue-number>-*")
```

If a PR exists, proceed to Step 2. If no PR exists but the expected branch exists, the agent may have pushed commits and died before opening the PR — clone the branch directly and assess the work (Step 2) rather than re-spawning. If neither exists, the agent died before producing any artifact; a brief additional wait (5–10 minutes) is warranted before re-spawning.

**Step 2: Assess the work.**

Clone the PR's head branch using the PR head SHA or by fetching the PR ref directly — do not assume the source branch name maps to a remote ref (fork-based PRs or already-deleted branches will fail a plain checkout):

```bash
# Prefer fetching by PR ref (works for fork PRs and deleted source branches)
git clone <base-repo> /tmp/recovery-<issue>
cd /tmp/recovery-<issue>
git fetch origin pull/<pr-number>/head:pr-head
git checkout pr-head
npm ci && npm test && npm run build   # or equivalent for the stack
```

Also check that the PR is still mergeable (no merge conflicts with the current base branch). A branch that was green when the agent died may have accumulated conflicts with main in the interim. Use the PR's `mergeable_state` field or attempt a local merge-check before committing to merge:

```bash
git fetch origin main:main
git merge-tree $(git merge-base HEAD main) main HEAD
# non-empty CONFLICT output → branch has drifted; do not squash-merge without resolving
```

If tests fail, the artifact is not green. Document what fails, open a new sprint with a targeted fix scope, and do not merge the broken PR.

If tests pass, treat the work as complete unless there is specific reason to doubt correctness.

**Step 3: Self-review the diff.**

The automated review tool will return `skipped_already_reviewed` if it has already posted a marker comment on the current head SHA. Note that this proves only that a marker was posted — not that the review ran to completion or produced findings. After an agent or tool crash, the marker comment may exist even if the review was interrupted mid-run. In this case, identify what has been reviewed and what remains unreviewed:

```bash
# Find the last automated review SHA (from the review_pr marker comment on the PR)
# Do not scope to a subdirectory — include all paths to catch changes in
# package.json, lockfiles, CI config, migrations, or generated assets
git diff <last-reviewed-sha>..<head-sha>
```

If this delta is **empty** (the agent died without pushing any commits since the last automated review), the automated review already covered the full current state. In this case, check the PR for any unresolved review comments from that automated review — address those or explicitly accept them before merging.

If the delta is **non-empty** (the agent pushed commits after the last automated review), manually inspect those commits. Also verify the full diff from main satisfies the issue requirements — earlier automated review comments may have been partially addressed.

For methodology or computation code (evaluators, data pipelines, statistical samplers), read the core logic against the spec — passing tests do not catch verdict-corrupting bugs.

**Step 4: Verify CI and merge if green.**

Before squash-merging, confirm CI has completed successfully on the current head SHA. Do not rely on tests passing locally — CI may run additional checks (security audits, deployment previews, integration tests) that local runs skip:

```
# Check CI status via the check-runs API (not the legacy statuses API)
check_runs = GET /repos/{owner}/{repo}/commits/{head-sha}/check-runs
require all(cr.conclusion == "success" for cr in check_runs)
```

If CI is pending, wait for it to complete before merging. If CI is failing on the recovered PR, treat it as a partially-broken artifact and spawn a targeted fix sprint rather than force-merging.

If CI is green, squash-merge the PR:

```
merge_pull_request(method="squash")
```

Do not re-run the full sprint. The work is done. Recovery cost: ~10 minutes. Re-sprint cost: ~45 minutes.

**Step 5: Close the issue with a recovery note.**

Comment on the original issue explaining:
- The sprint died mid-flight (connection error / session timeout)
- The artifact was recovered via verify-and-merge
- The merge SHA and test status

This creates a clear record for future reference. Close the issue as resolved.

```
Closes #<issue>

Sprint died mid-flight (CAPIError: Connection error after 5 retries) during the review/refinement loop. PR was left open with passing tests. Recovered via verify-and-merge: cloned head branch, ran test suite (all green), manually reviewed the diff against issue spec, squash-merged. No re-sprint was required.

Merge SHA: <sha>
```

**Decision tree summary:**

```
No completion notification received after 2× expected duration:
  ↓
  Does a PR (or branch) for this task exist? (use issue-number as discriminator)
  ├── No → wait 5–10 min, then re-spawn (agent died before producing artifact)
  ├── Branch exists, no PR → fetch branch, run tests (agent died before PR creation)
  └── PR exists → fetch via pull/<N>/head ref, run tests
                  ├── Tests fail → spawn targeted fix sprint (do not merge broken PR)
                  └── Tests pass → self-review diff vs issue spec
                                  ├── Delta since last review is empty?
                                  │   └── Check for unresolved automated review comments
                                  ├── Blocking issues found → open targeted fix PR
                                  └── No blocking issues → squash-merge, close issue
```

## Evidence

Two consecutive sprint agents died mid-flight on the same project (factor-dashboard, 2026-06-25), both during the review/refinement loop after posting a `review_pr` marker comment:

**Sprint for issue #71**: Died with `CAPIError: Connection error` after 5 retries. PR was open; the last action in the thread was a `review_pr` tool call left in `⚙️ running...` state. Recovery: cloned head, `npm ci && npm test && npm run build` (green), manual diff review (no issues), squash-merged. Recovery time: ~10 minutes.

**Sprint for issue #72**: Same failure mode, same day. Same recovery procedure. Recovery time: ~10 minutes.

Both sprints had run ~35–45 minutes before dying. A full re-sprint on either would have cost another 35–45 minutes. Total time saved across two recoveries: ~60–70 minutes.

The review tool idempotency behavior was confirmed in both cases: `review_pr` returned `skipped_already_reviewed` because a marker comment already existed at the head SHA. Manual diff review was required.

## Tradeoffs

**Benefit**: Recovery cost (~10 min) is 4–5× cheaper than re-sprint cost (~45 min). The original work is preserved. No branch collision risk.

**Cost**: Manual diff review is less thorough than a full multi-model review. For simple feature work, this tradeoff is acceptable. For complex or methodology-sensitive code, the manual review bar should be higher.

**Watch out for:**

- **Lost refinements**: If the agent died mid-refinement with uncommitted changes, those changes are gone. The last committed SHA is the recoverable state. Verify the committed state (not the intended final state) satisfies the issue requirements.
- **Partially-committed review fixes**: The agent may have committed a partial fix from a review round before dying. The committed state may be "better than original but not fully reviewed." The manual review step must cover the full diff from main, not just the last commit.
- **Over-merging without review**: Skipping the manual diff review because tests pass is the most common failure mode of this pattern. Passing tests do not substitute for reading the code. Always inspect the diff.

## Related Patterns

- **[Duplicate Agent Spawn Prevention](/agent-prompt-patterns/patterns/duplicate-agent-spawn-prevention)** — the complementary pattern: before spawning a replacement, check whether the original is still live; Dead Sprint Recovery handles the case where it is confirmed dead but left an artifact
- **[Side-Effect Verification](/agent-prompt-patterns/patterns/side-effect-verification)** — the core discipline: verify the artifact (PR, tests, diff) before concluding the work is done or undone
- **[Circuit Breaker](/agent-prompt-patterns/patterns/circuit-breaker)** — upstream resilience: a circuit breaker reduces the probability of mid-flight death by failing fast on known-bad conditions rather than exhausting retries
- **[Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation)** — the supervisor's role during recovery is observer (assess artifact state) before it becomes actor (merge or re-spawn)
