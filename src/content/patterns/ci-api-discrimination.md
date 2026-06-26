---
title: "CI API Discrimination"
category: "task-design"
evidenceLevel: "strong"
summary: "CI platforms expose two separate APIs for build status: a legacy commit-statuses endpoint and a newer check-runs endpoint. Modern CI systems (e.g., GitHub Actions) report exclusively through check runs. Querying the legacy endpoint returns empty results that look like 'no CI' or 'CI pending', causing premature merges or indefinite blocking. Always query the check-runs endpoint as authoritative and treat an empty statuses response as 'no legacy hooks', not as a CI signal."
relatedPatterns: ["side-effect-verification", "enumeration-first-verification", "follow-through-discipline"]
tags: ["ci", "github-actions", "check-runs", "commit-statuses", "merge-gating", "api-discrimination", "task-design"]
---

## Problem

An agent is about to merge a pull request. It queries the CI status endpoint and receives:

```json
{ "state": "pending", "total_count": 0 }
```

What should it conclude?

The natural reading is "CI is queued or running." So the agent waits, or retries, or — after a timeout — concludes "no CI configured" and proceeds to merge.

Both conclusions are wrong. The result means *no legacy commit-status hooks exist* for this commit. Whether CI is green, red, running, or configured at all is a completely separate question — answered by a completely separate API.

Modern CI systems like GitHub Actions do not write to the commit-statuses endpoint. They report through *check runs*. A repository that uses GitHub Actions exclusively will return `total_count: 0` on the statuses endpoint for every commit, for every PR, forever — regardless of whether CI is passing, failing, or running.

This creates three distinct failure modes:

**Premature merge**: The agent interprets `total_count: 0` as "no CI to wait for" and merges. A failing Actions workflow goes undetected. Code with broken tests, security vulnerabilities caught by audit gates, or build failures lands on the default branch.

**Indefinite blocking**: The agent interprets `total_count: 0` as "CI pending" and waits for a status that will never arrive. Merges stall. Manual intervention is required. The agent escalates unnecessarily.

**Silent red CI**: GitHub Actions quota exhaustion produces the same `total_count: 0` response on the statuses endpoint — but the same also applies to the check-runs endpoint when quota is depleted and workflows never ran. The check-runs endpoint is still the correct endpoint to query; the distinction is that an empty check-runs response means "no checks recorded," which requires explicit handling (flag for review, do not treat as passing). An agent that treats empty check-runs as "CI passed" has the same failure mode as one using the statuses endpoint — just less often.

The root cause is treating a single endpoint as the complete CI picture when it covers only a subset of CI systems — specifically, the legacy subset.

## Context

This pattern applies whenever an agent:

- Is about to merge a pull request and needs to verify CI is green
- Is diagnosing "why is CI pending?" or "is there any CI configured?"
- Is building automation that gates on build status
- Is using any platform that separates "commit statuses" from "check runs" (or equivalent primitives)

The pattern is most critical on repositories that use GitHub Actions as their sole CI provider, since these repos have zero legacy statuses and will always return `total_count: 0` on the statuses endpoint.

It also applies to any CI platform with a similar two-tier API (e.g., separate "required status checks" vs. "check suites" in newer GitHub API versions, or equivalent splits in other hosted VCS platforms).

## Solution

**Before gating a merge on CI results, query both CI API surfaces and interpret the results correctly. The most reliable merge-readiness signal is `mergeable_state: "clean"` on the PR object; direct check-run inspection is a lower-level fallback with important edge cases.**

### Step 1: Understand what CI surfaces exist

Check-runs and statuses are not mutually exclusive. A repository may have both, one, or neither:

- **GitHub Actions** → check-runs endpoint (workflows write check runs, not statuses)
- **Legacy CI (Travis, older CircleCI, external bots writing to the statuses API)** → combined-status endpoint
- **Third-party CI bots / GitHub Apps** → may write to check-runs without workflow files

**The safe default**: always query both endpoints. The file listing (`.github/workflows/`) is a hint, not a guarantee — workflow files may be path-filtered, branch-filtered, or disabled for the event type. Always treat the API responses as ground truth.

### Step 2: Query both endpoints

**For workflow-based CI (GitHub Actions):**

```
GET /repos/{owner}/{repo}/commits/{sha}/check-runs
```

Passing conclusions (do not block merge): `"success"`, `"neutral"`, `"skipped"`.
Failing conclusions (block merge): `"failure"`, `"timed_out"`, `"action_required"`, `"cancelled"`, `"startup_failure"`, `"stale"`.
Still running (wait and retry): any check with `status` of `"queued"` or `"in_progress"`.

> **Important**: The check-runs endpoint does not label which checks are *required*. The list includes all checks — required and optional alike. Applying pass/fail logic to *all* checks will block on optional failures. To accurately determine required checks, consult the repository's branch protection rules — but note that org-level rulesets may require elevated permissions and are not fully represented in the branch protection endpoint. **Prefer `mergeable_state: "clean"` as the simpler alternative** — GitHub computes it from required checks, reviews, and conflicts, so it is more reliable than manual required-check discrimination.

> **Pagination and reruns**: The check-runs endpoint defaults to returning only the latest attempt per check (`filter=latest`). Do not page through history expecting multiple historical attempts — the default response shape is the current state. If you explicitly request `filter=all`, deduplicate by check name and use only the most recent attempt to avoid false failures from an older attempt that was subsequently retried and passed.

**For legacy status-based CI:**

```
GET /repos/{owner}/{repo}/commits/{sha}/statuses
(returns an array; the composite rollup is:)
GET /repos/{owner}/{repo}/commits/{sha}/status
```

The combined-status endpoint (`/status`, singular) returns the composite `state` field and `total_count`. The list endpoint (`/statuses`, plural) returns individual status objects as an array without a `state` wrapper. Use the combined-status endpoint for merge-gating. `total_count > 0` is required to have a meaningful composite signal.

### Step 3: Distinguish empty from pending

| Endpoint | Result | Correct interpretation |
|----------|--------|----------------------|
| Combined-status | `total_count: 0` | No legacy hooks configured — not a CI signal |
| Check-runs | `total_count: 0` | No check runs recorded — CI may not have triggered (or quota exhausted) |
| Check-runs | All checks `conclusion: "success"/"neutral"/"skipped"` | CI passed (required-check discrimination still needed) |
| Check-runs | Any check `status: "in_progress"/"queued"` | CI still running — wait and retry |
| Check-runs | Any check `conclusion: "failure"/"timed_out"/"action_required"/"startup_failure"/"stale"` | CI failed — do not merge |

### Alternative: Use `mergeable_state`

The `mergeable_state` field on a PR object is a composite signal computed by the platform from all check-runs + statuses + reviews:

```
GET /repos/{owner}/{repo}/pulls/{pull_number}
→ .mergeable_state === "clean"     ✓ safe to merge (all checks passed, no conflicts)
→ .mergeable_state === "blocked"   ✗ checks failing or review required
→ .mergeable_state === "unstable"  ✗ non-required checks failing
→ .mergeable_state === "dirty"     ✗ merge conflict — rebase required
→ .mergeable_state === "behind"    ✗ branch out of date with base
→ .mergeable_state === "draft"     ✗ PR marked draft — not ready
→ .mergeable_state === "unknown"   ? transient — recomputing, retry after 5–10s
```

`mergeable_state: "clean"` is a practical shortcut for merge-gating. GitHub computes it from required check-runs, required statuses, review approvals, and merge conflicts. It is an eventually-consistent field (may briefly show `"unknown"` while recomputing) and folds in more than CI state — it also reflects review requirements and branch divergence. This makes it useful as a single merge-readiness gate when you want a composite answer, but it is not a pure CI signal. For CI-specific diagnosis (understanding *why* CI failed), query check-runs directly.

### Prompt template for merge-gating tasks

```
## Pre-merge CI check (required before any merge action)

1. Always query BOTH surfaces for the PR's head SHA:
   - Check-runs: GET /repos/{owner}/{repo}/commits/{sha}/check-runs
   - Combined-status: GET /repos/{owner}/{repo}/commits/{sha}/status

2. Evaluate check-runs result:
   - If any check has status "in_progress" or "queued" → CI is running, WAIT and retry
   - If any check has conclusion "failure", "timed_out", "action_required", "cancelled",
     "startup_failure", or "stale" → CI FAILED, do not merge
   - If all checks have conclusion "success", "neutral", or "skipped" → check-runs are green
     (note: this includes optional checks — use mergeable_state to confirm only required checks matter)
   - If total_count is 0 → no check runs recorded (see step 4)

3. Evaluate combined-status result:
   - If total_count > 0 and state !== "success" → legacy CI is not green, do not merge
   - If total_count is 0 → no legacy hooks, not a CI signal (skip)

4. If BOTH check-runs and combined-status return total_count: 0 → no CI signal has been recorded yet.
   This covers several distinct states: CI not configured, workflow did not trigger (event/path filter),
   required check expected but not yet emitted, or quota exhausted. Do NOT treat this as "repo has no CI"
   and proceed. Instead: BLOCK and flag for human review. Merging when no CI signal exists is unsafe.

5. Treat total_count: 0 on the combined-status endpoint as "no legacy hooks" — never as "CI pending" or "CI passed."
   Treat total_count: 0 on the check-runs endpoint as "CI has not run (yet or at all)" — not as "CI passed."
```

## Evidence

Multiple production incidents in an AI agent system (autogent, May–June 2026):

**Systematic false-pending (2026-05)**: Sprint agents consistently reported "CI pending" on every PR in the autogent repository. Root cause: the merge-gating check used `pull_request_read method=get_status`, which queries the commit-statuses API. The repository uses GitHub Actions exclusively — no legacy status hooks. Every PR returned `total_count: 0, state: "pending"`. Agents correctly parsed this as "no legacy statuses" but incorrectly treated it as a blocking CI signal. Every sprint with automated merge logic stalled.

**Three PRs merged on silent red CI (2026-06-20)**: A new transitive dependency vulnerability triggered the GitHub Actions audit gate. Because agents were checking the statuses endpoint (which showed nothing) and not the check-runs endpoint (which showed the audit failure), all three PRs were assessed as CI-green and merged. The vulnerability landed on the default branch. A manual fix PR (#648) was required.

**Quota exhaustion indistinguishable from silent green (observed)**: When GitHub Actions quota was depleted, the statuses endpoint returned the same `total_count: 0` as when CI ran successfully. Without checking check-runs directly, agents could not detect that CI had not run at all.

All three failure modes — stalling, premature merge, and silent-red — share the same root: using the statuses endpoint as a proxy for overall CI health on a check-runs–only repository.

**Evidence level: strong** — three distinct failure modes observed in production, each traceable to the same API discrimination error. Pattern is tool-agnostic and applies to any CI setup with equivalent API separation.

## Tradeoffs

**Benefit**: Prevents premature merges on failing CI and eliminates indefinite blocking on a signal that will never arrive. Querying both surfaces (check-runs + combined-status) routes the agent to the correct signal regardless of CI type.

**Cost**: Requires two API calls per merge-gate check instead of one. Adds a small amount of pre-merge logic. This cost is negligible relative to the cost of merging broken code. The `mergeable_state` shortcut reduces this to one call when CI-specific diagnosis is not needed.

**Watch out for**:
- **Hybrid repos**: Some repositories use both GitHub Actions (check-runs) and legacy status hooks (e.g., third-party CI bots). In these cases, both endpoints may be relevant. Query both and require all checks to pass.
- **`mergeable_state: "unknown"` false negatives**: Always retry on `"unknown"` with a brief wait (5–10s) before treating it as a failure. It is a transient compute state, not a permanent CI result.
- **Check-run name changes**: If you are waiting for a specific named check (e.g., `"CI / build"`), a renamed workflow will cause the agent to wait indefinitely for the old name. Prefer checking that *all* checks passed rather than a specific named subset.
- **Quota exhaustion**: When Actions quota is depleted, workflows never trigger — check-runs are also empty (`total_count: 0`). An empty check-runs result means "CI has not run," not "CI passed." Treat an empty check-runs result as an unknown state requiring human review, unless the repository is explicitly configured with no CI (both check-runs and combined-status empty by design — flag and get confirmation before merging).
- **Repos with no check-runs (status-only)**: Some repositories rely exclusively on legacy commit statuses and produce zero check runs. In these cases, `total_count: 0` on the check-runs endpoint is expected and benign — gating requires only that the combined-status endpoint reports `state: "success"` with `total_count > 0`.

## Related Patterns

- **[Side-Effect Verification](/agent-prompt-patterns/patterns/side-effect-verification)** — merge-gating is a side-effect verification step; CI API discrimination ensures the verification queries the correct signal
- **[Enumeration-First Verification](/agent-prompt-patterns/patterns/enumeration-first-verification)** — before asserting CI state, enumerate which API surfaces exist (statuses vs. check-runs) rather than assuming a single endpoint is complete
- **[Follow-Through Discipline](/agent-prompt-patterns/patterns/follow-through-discipline)** — CI discrimination prevents the failure mode where an agent declares a merge "done" without verifying the authoritative CI signal
