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

**Silent red CI**: GitHub Actions quota exhaustion produces the same `total_count: 0` response on the statuses endpoint. An agent using only the statuses API cannot distinguish "Actions ran and passed" from "Actions quota exhausted and never ran."

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

**Before gating a merge on CI results, identify which API the CI system uses and query the correct endpoint.**

### Step 1: Identify the CI type

Check for workflow files in the repository:

```
.github/workflows/*.yml   →  GitHub Actions (check-runs endpoint)
.travis.yml               →  Travis CI (may use statuses endpoint)
.circleci/config.yml      →  CircleCI (may use statuses or check-runs)
```

If workflow files exist, the repository uses check-runs. The statuses endpoint is irrelevant.

### Step 2: Query the authoritative endpoint

**For workflow-based CI (GitHub Actions):**

```
GET /repos/{owner}/{repo}/commits/{sha}/check-runs
```

Require every check's `conclusion === "success"`. If any check has `status !== "completed"`, CI is still running. If any check has `conclusion !== "success"`, CI has failed.

**For legacy status-based CI:**

```
GET /repos/{owner}/{repo}/commits/{sha}/statuses
```

The `state` field is the composite result. `total_count > 0` is required to have a meaningful signal.

### Step 3: Distinguish empty from pending

| Endpoint | Result | Correct interpretation |
|----------|--------|----------------------|
| Statuses | `total_count: 0` | No legacy hooks configured — not a CI signal |
| Check-runs | `total_count: 0` | No check runs exist — CI may not have triggered |
| Check-runs | All `conclusion: "success"` | CI passed |
| Check-runs | Any `status: "in_progress"` | CI still running |
| Check-runs | Any `conclusion: "failure"` | CI failed |

### Alternative: Use `mergeable_state`

The `mergeable_state` field on a PR object is a composite signal computed by the platform from all check-runs + statuses + reviews:

```
GET /repos/{owner}/{repo}/pulls/{pull_number}
→ .mergeable_state === "clean"  ✓ safe to merge
→ .mergeable_state === "blocked"  ✗ checks failing or review required
→ .mergeable_state === "unstable"  ✗ checks failing but not blocking
```

`mergeable_state: "clean"` is a reliable single-field alternative to directly querying check-runs, because GitHub computes it from the authoritative signal across all CI types. Use it when you want a single merge-readiness check rather than per-check granularity.

> **Caveat**: `mergeable_state` can return `"unknown"` briefly after a force push or new commit while GitHub recomputes it. If `"unknown"`, wait and retry rather than treating it as a failure.

### Prompt template for merge-gating tasks

```
## Pre-merge CI check (required before any merge action)

1. Check for workflow files: `ls .github/workflows/`
   - If present: this repo uses GitHub Actions → check-runs API is authoritative
   - If absent: check for legacy CI config files → statuses API may apply

2. Query the authoritative endpoint for the PR's head SHA:
   - GitHub Actions: GET /repos/{owner}/{repo}/commits/{sha}/check-runs
   - Legacy CI: GET /repos/{owner}/{repo}/commits/{sha}/statuses

3. Do NOT proceed with merge if:
   - Any check_run has status !== "completed"
   - Any check_run has conclusion !== "success"
   - The statuses endpoint returns total_count: 0 AND no workflow files exist (no CI at all — flag for review)

4. Treat total_count: 0 on the statuses endpoint as "no legacy hooks" — never as "CI pending" or "CI passed."
```

## Evidence

Multiple production incidents in an AI agent system (autogent, May–June 2026):

**Systematic false-pending (2026-05)**: Sprint agents consistently reported "CI pending" on every PR in the autogent repository. Root cause: the merge-gating check used `pull_request_read method=get_status`, which queries the commit-statuses API. The repository uses GitHub Actions exclusively — no legacy status hooks. Every PR returned `total_count: 0, state: "pending"`. Agents correctly parsed this as "no legacy statuses" but incorrectly treated it as a blocking CI signal. Every sprint with automated merge logic stalled.

**Three PRs merged on silent red CI (2026-06-20)**: A new transitive dependency vulnerability triggered the GitHub Actions audit gate. Because agents were checking the statuses endpoint (which showed nothing) and not the check-runs endpoint (which showed the audit failure), all three PRs were assessed as CI-green and merged. The vulnerability landed on the default branch. A manual fix PR (#648) was required.

**Quota exhaustion indistinguishable from silent green (observed)**: When GitHub Actions quota was depleted, the statuses endpoint returned the same `total_count: 0` as when CI ran successfully. Without checking check-runs directly, agents could not detect that CI had not run at all.

All three failure modes — stalling, premature merge, and silent-red — share the same root: using the statuses endpoint as a proxy for overall CI health on a check-runs–only repository.

**Evidence level: strong** — three distinct failure modes observed in production, each traceable to the same API discrimination error. Pattern is tool-agnostic and applies to any CI setup with equivalent API separation.

## Tradeoffs

**Benefit**: Prevents premature merges on failing CI and eliminates indefinite blocking on a signal that will never arrive. A single discriminator check (workflow files present?) routes the agent to the correct API.

**Cost**: Requires one additional API call to identify CI type (or inspection of the repository's `.github/workflows/` directory). Adds a small amount of pre-merge logic. This cost is negligible relative to the cost of merging broken code.

**Watch out for**:
- **Hybrid repos**: Some repositories use both GitHub Actions (check-runs) and legacy status hooks (e.g., third-party CI bots). In these cases, both endpoints may be relevant. Query both and require all checks to pass.
- **`mergeable_state: "unknown"` false negatives**: Always retry on `"unknown"` with a brief wait (5–10s) before treating it as a failure. It is a transient compute state, not a permanent CI result.
- **Check-run name changes**: If you are waiting for a specific named check (e.g., `"CI / build"`), a renamed workflow will cause the agent to wait indefinitely for the old name. Prefer checking that *all* checks passed rather than a specific named subset.
- **Quota exhaustion + check-runs**: When Actions quota is depleted, check-runs are also empty (`total_count: 0`). No checks running is not the same as all checks passing. Treat an empty check-runs result as "CI has not run" rather than "CI passed" — escalate or block.

## Related Patterns

- **[Side-Effect Verification](/agent-prompt-patterns/patterns/side-effect-verification)** — merge-gating is a side-effect verification step; CI API discrimination ensures the verification queries the correct signal
- **[Enumeration-First Verification](/agent-prompt-patterns/patterns/enumeration-first-verification)** — before asserting CI state, enumerate which API surfaces exist (statuses vs. check-runs) rather than assuming a single endpoint is complete
- **[Follow-Through Discipline](/agent-prompt-patterns/patterns/follow-through-discipline)** — CI discrimination prevents the failure mode where an agent declares a merge "done" without verifying the authoritative CI signal
