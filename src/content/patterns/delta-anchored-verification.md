---
title: "Delta-Anchored Verification"
category: "feedback-loops"
evidenceLevel: "strong"
summary: "Verification steps that check a static postcondition — 'URL returns 200', 'tests pass', 'marker found in HTML' — can be satisfied by the prior state without the work actually being correct (Goodhart's Law applied to agentic verification). Design at least one verification step that confirms a measurable CHANGE from a known prior state via an independent channel."
relatedPatterns: ["side-effect-verification", "deploy-lag-verification", "client-rendered-deploy-verification", "empirical-validation-loop", "sprint-completion-verification", "observer-actor-separation"]
tags: ["verification", "deployment", "reliability", "false-positive", "goodharts-law", "delta-check", "ci", "static-postcondition", "tier:2-standard"]
---

## Problem

Agents design verification steps that can be satisfied *without* genuine correctness. The agent checks the metric, the metric passes, the agent reports success — but the real outcome is broken. This is Goodhart's Law applied to agentic verification: when a verification step becomes a target, it ceases to be a good measure.

The failure mode is structural, not incidental. Static postcondition checks — "does the URL return 200?", "do the tests pass?", "is the marker string present?" — can all return the right answer even when the work failed. They verify that some expected value exists in the world, but the expected value may have been there *before* the work happened.

Three concrete failure signatures, each documented in production:

### Failure 1 — HTTP 200 on stale deploy

> "verify_deploy on the base URL returns HTTP 200 the whole time (stale last-good build). When the build job SUCCEEDED but deploy job FAILED, the prior build is still served — a 200 is returned with old content indefinitely." — CONTEXT.md; factor-dashboard #114, #115, ai-security-blog #215, agent-prompt-patterns #96

An agent calls `verify_deploy(url)` → gets HTTP 200 → reports "verified live." The check passed because the prior build — not the new one — is still being served. HTTP 200 is a static postcondition: it tells the agent "a server responded," not "the work I just did is what's running." The same 200 would be returned regardless of whether the new deploy succeeded, failed, or never started.

### Failure 2 — "All tests pass" coexisting with broken CI

> "A sprint's '✅ merged, all tests pass, tsc clean' can COEXIST with a red post-merge CI + broken deploy — vitest/esbuild strips types at runtime, so green local tests do NOT imply `npx tsc` passes." — CONTEXT.md; cli-wrapper-monitor #128→#129

An agent runs `npm test` → all 919 tests pass → reports "tsc clean, tests pass." The post-merge CI's separate `npx tsc` step fails, the deploy is skipped, and the new feature never ships. "All tests pass" is a static postcondition on the *local* test suite, not on the CI check that actually gates deployment. The metric passes; the outcome fails.

### Failure 3 — Marker-grep on static HTML shell

> "Marker-grep still passes — a false-positive 'live' confirmation. To truly verify a panel renders, do a browser render check." — CONTEXT.md; factor-dashboard #115 (~14 panels stuck "Loading…" in prod for ~a day while served-HTML marker-grep passed)

An agent greps the served HTML for a component's title string → finds it → reports "verified live." The marker string is in the HTML shell because Astro ships markup regardless of whether client-side JavaScript hydrated the component. The marker was always going to be there. It cannot distinguish between "component loaded and rendered data" and "component placeholder is in the HTML but stuck Loading…".

### Root cause: the check cannot distinguish "before" from "after"

All three failures share a structural root: the verification step produces the same result whether or not the work succeeded. An HTTP 200 existed before the deploy. Test suites passed before the new TypeScript interface was added. The marker string existed in the HTML before the dynamic import was fixed. These are static postconditions — they verify membership in a set, not transition into that set.

A delta check solves this by anchoring verification to a *change*: it records a known state *before* the action and confirms a *measurable difference* afterward via a channel independent from the action itself.

## Context

This pattern applies whenever:

- An agent performs an action and then verifies its outcome using only a check that could pass before the action happened
- The system being verified has a "previous good state" that can satisfy postcondition checks (a cached page, a passing test suite, existing HTML)
- The agent's verification tooling does not natively provide a before-after comparison (most deployment health checks, test runners, and HTML fetchers do not)
- Multiple actions happen concurrently or sequentially and a passing check could reflect a different agent's earlier action rather than the current one

It does **not** apply when:

- The action creates something genuinely new (a file that didn't exist, a row with a unique ID) — here the postcondition uniquely implies the action
- The platform provides an authoritative action-linked status (a GitHub Actions run ID tied to a specific commit SHA, a Kubernetes rollout linked to an image SHA) — the platform does the delta tracking for you
- Verification cost exceeds correction cost and the operation is idempotent (it can safely be re-run if wrong)

## Solution

**Before performing the action, record a state anchor. After the action, confirm the anchor changed.**

The anchor is any observable that is expected to change when the action succeeds, captured via a channel independent from the action itself.

### Delta check design principles

**1. The anchor must predate the action**

Record the anchor *before* the action, not inferred from memory or assumed from context. An anchor inferred after the fact can be contaminated by the action's output.

**2. The channel must be independent**

The verification channel must not go through the same code path as the action. Verifying a deploy via the same endpoint that performed the deploy tells you the endpoint is reachable, not that the action succeeded. Use a different API, a different read path, or a different artifact.

**3. The delta must be specific to the action**

A timestamp changing proves *something* happened; a content hash or commit SHA changing proves *the right thing* happened. Prefer specific deltas (commit SHA, content hash, run conclusion) over imprecise ones (timestamp, "it looks different").

### Concrete delta patterns by verification scenario

**Deploy verification (replaces HTTP 200 check)**

```bash
# Before deploy: record the current serving commit SHA
# Uses an async IIFE so top-level await works in CommonJS node -e mode
BEFORE_SHA=$(node -e "(async()=>{const r=await fetch('https://example.github.io/app/?cb='+Date.now(),{cache:'no-store'});const h=await r.text();const m=h.match(/data-build-sha=\"([a-f0-9]+)\"/);console.log(m?m[1]:'unknown');})()")

# [perform deploy / merge / push]

# After deploy: confirm the serving SHA changed
# Repeat with delay until SHA changes (CDN propagation) or timeout
AFTER_SHA=$(node -e "(async()=>{const r=await fetch('https://example.github.io/app/?cb='+Date.now(),{cache:'no-store'});const h=await r.text();const m=h.match(/data-build-sha=\"([a-f0-9]+)\"/);console.log(m?m[1]:'unknown');})()")
if [ "$BEFORE_SHA" = "$AFTER_SHA" ]; then
  echo "FAIL: serving SHA unchanged after deploy"
else
  echo "PASS: serving SHA changed $BEFORE_SHA → $AFTER_SHA"
fi
```

**If the site does not embed a build SHA**, use the GitHub Actions run result for the merge commit as the strongest available delta signal — the deploy is confirmed when the run tied to the merge SHA concludes `success`, not when a health check returns 200. Note: this check goes through the CI/CD platform rather than a fully orthogonal channel, but it uniquely identifies the action (a run cannot exist before the merge that triggered it), and the deploy job's `success` conclusion indicates the artifact was built and published. Filter to the specific workflow that owns the deploy job — a SHA can have multiple workflow runs (CI, lint, deploy), and the CI workflow succeeding does not imply the deploy workflow succeeded:

```
# After merging SHA=<merge_sha>:
# 1. Query Actions runs: GET /repos/{owner}/{repo}/actions/runs?head_sha=<merge_sha>
#    Filter by workflow name/path to the deploy workflow specifically
#    (e.g., ?workflow_id=deploy.yml or filter runs by workflow_name in the response)
# 2. For the deploy workflow run, fetch its jobs:
#    GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs
# 3. Confirm the deploy job's conclusion === "success"
#    (run.conclusion is the rolled-up result; check per-job conclusion for the specific deploy job)
# This is the delta: a run that did not exist before the merge now exists and its deploy job succeeded.
# A 200 on the URL does NOT replace this check.
```

**CI verification (replaces "tests pass" check)**

Never declare "CI clean" from local test output alone. The delta is the post-merge CI run for the *specific merge commit SHA*, checked per-job:

```
After merge of SHA=<merge_sha>:
1. Query the Actions API: GET /repos/{owner}/{repo}/actions/runs?head_sha=<merge_sha>
   — Note: multiple runs may exist for one SHA (different workflow files).
     Query each relevant workflow's run by filtering by workflow name/path.
2. For each required workflow (build, test, deploy):
   a. Fetch its jobs: GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs
   b. Assert: each job's conclusion === "success"
      (tsc, vitest, lint, and deploy are separate jobs — check all)
3. Only then declare CI clean.

Do NOT use "local tests passed" as a substitute.
The delta is: new CI runs appeared, linked to the merge SHA, and ALL required jobs concluded success.
```

**Rendered-content verification (replaces marker-grep)**

The delta is a rendered value that only exists if the dynamic logic executed correctly — not a markup string that exists in the HTML shell regardless:

```
For a dashboard panel that fetches and displays data:
  WRONG: grep served HTML for panel title (present in HTML shell regardless of hydration)
  RIGHT: check that the panel's data values are present in the rendered DOM
         (only present if JavaScript fetched data and hydrated the component)

Concretely:
  - Before: note the expected state (e.g., "panel should show a non-empty chart after load")
  - After: browser render → assert canvas/content elements count > 0
           AND assert no PERSISTENT "Loading…" indicators for the panels you just deployed
           (apps may show transient loading spinners; wait for networkidle, then check)
  The delta: the panel went from placeholder → data (provable only via browser render)
  Note: some apps intentionally keep background-loading indicators for non-critical data;
  scope your assertion to the specific components affected by the deployed change.
```

### Anchoring to the merge SHA (the most general delta)

For GitHub-Pages-style deploys on repositories with a single deploy workflow, the merge SHA is a strong anchor. A check that confirms "the deploy run for SHA X concluded success AND the artifact on-disk reflects SHA X" is stronger than any HTTP check. Note that this does not apply to repos using selective deploy conditions (e.g., only deploy when tag matches, or feature-flag gated rollouts) — in those cases, verify the deploy condition was also met:

```
Delta check flow for any Pages/static site deploy:
1. Record merge SHA: git.head_sha = <sha_of_merged_commit>
2. Query Actions: find the deploy workflow run where head_sha = <sha_of_merged_commit>
   (filter to the deploy workflow specifically, not CI-only workflows)
3. Wait for run.conclusion = "success" (the deploy job specifically, not just the build job)
4. (Optional) Cache-bypass fetch of the live URL + extract any embedded SHA/hash

The delta: a run that did not exist before the merge now exists and concluded success.
HTTP 200 is a necessary but not sufficient postcondition — add the SHA-linked run check.
```

### Prompt template

```
Before [action]: record [specific anchor] via [independent channel].
After [action]: confirm [specific delta from anchor] via [same channel].
Do NOT declare [action] successful until the delta is confirmed.

For deploys: anchor = Actions run conclusion for merge SHA (not HTTP status)
For CI: anchor = post-merge CI run jobs conclusion for merge SHA (not local test output)
For rendered content: anchor = rendered data values (not HTML shell marker strings)
```

## Evidence

The following incidents are documented in production CONTEXT.md and provide direct evidence for each failure mode. All involve agents reporting success based on static postcondition checks while the actual outcome was broken.

**HTTP 200 false positive (factor-dashboard #114, #115; ai-security-blog #215; agent-prompt-patterns #96):**
Deploy jobs failed or were skipped. The prior build continued to be served. `verify_deploy(url)` returned HTTP 200 throughout. Agents declared deployments confirmed. New content was never live. In each case, the fix required checking the Actions run conclusion for the merge SHA — a check that would have immediately distinguished "prior build serving" from "new build serving."

**Local tests / tsc false positive (cli-wrapper-monitor #128→#129):**
A sprint merged `6d068cf` and reported "919 tests pass; tsc clean." Post-merge CI showed both the `CI` job (npx tsc) and the `Publish Dashboard` build job failed. The deploy was skipped. The dashboard was stuck on the prior build for ~15 minutes with the new feature absent. The delta check (confirm CI run for the merge SHA concludes success, checking EACH job) would have surfaced the failure immediately.

**Marker-grep false positive (factor-dashboard #115):**
A dynamic-import bug missing `${base}` path prefix caused 14 interactive panels to remain stuck "Loading…" in production for approximately one day. Static HTML marker-grep passed for every panel — the panel title strings were in the HTML shell regardless of hydration state. Only a browser render check (confirm visible content count > 0, confirm no visible "Loading…" in rendered DOM) correctly detected the failure.

All three incidents occurred in a production agentic CI/CD system (June–July 2026). In each case, the prescribed verification method was structurally incapable of distinguishing success from failure because it checked a condition the prior state already satisfied.

## Tradeoffs

**Benefit:** Eliminates the class of false-positive verifications that pass because the prior state satisfies the postcondition. A delta check is a true discriminator: it can only pass if something changed.

**Cost:** Delta checks require capturing state *before* the action, which adds a step. Some before-state records are natural (the merge SHA is known as soon as the merge call succeeds); others require an explicit pre-action read (fetching the current serving build hash before pushing a deploy). Before-state capture must happen in the action flow, not after the fact.

**Watch out for:**

- **Inferring the before-state from the action**: "The deploy ran at T, therefore the before-state was whatever was serving at T-1" is not a delta anchor — it uses the action to define its own baseline. Capture the before-state explicitly before the action.
- **Using an imprecise delta**: A timestamp changing proves something happened; a commit SHA or content hash changing proves the right thing happened. Prefer hashes and IDs over timestamps.
- **Skipping the delta when a platform provides an authoritative action-linked signal**: If GitHub Actions ties a run to a commit SHA, use that signal as the delta. Don't reimplement what the platform already tracks.
- **Delta checking on idempotent operations**: For operations that can safely be re-run if wrong (reads, idempotent writes), the verification cost may exceed the correction cost. Apply delta anchoring to irreversible or consequential actions where false positives have real cost.

## Related Patterns

- **[Side-Effect Verification](/agent-prompt-patterns/patterns/side-effect-verification)** — the foundational principle: verify observable outcomes, not return values; delta-anchored verification extends this by specifying that the observable must confirm a *change* from a known prior state, not just the existence of a value
- **[Deploy-Lag Verification](/agent-prompt-patterns/patterns/deploy-lag-verification)** — verifies that a fix is actually running (artifact rebuilt + process restarted after merge); delta-anchored verification is the complementary check that the *right* artifact is serving (anchored to the merge SHA)
- **[Client-Rendered Deploy Verification](/agent-prompt-patterns/patterns/client-rendered-deploy-verification)** — the SPA-specific verification protocol using cache-bypassing chunk-integrity checks; the chunk-integrity check is itself a delta check (chunks referenced by the *current* HTML exist at origin, anchored to the live HTML's chunk fingerprints)
- **[Empirical Validation Loop](/agent-prompt-patterns/patterns/empirical-validation-loop)** — treat post-action observations as measurements requiring the correct instrument; a static postcondition is the wrong instrument when the prior state satisfies it
- **[Sprint Completion Verification](/agent-prompt-patterns/patterns/sprint-completion-verification)** — after a sprint reports completion, verify PR/issue state via structured API query; `merged: true` (not `state: "closed"`) is the delta-anchored check — it can only be true after the merge action
- **[Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation)** — the observer role should verify via a channel independent from the actor's action path; delta anchoring provides the *criterion* for what the observer should verify
